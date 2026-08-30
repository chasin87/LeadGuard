import { afterAll, describe, expect, it } from "vitest";
import { database } from "@/server/database";
import { AuthorizationError } from "@/server/authorization/errors";
import {
  UrlValidationError,
  WebsiteNotFoundError,
} from "@/server/security/errors";
import {
  createTestOwner,
  createTestUser,
  deleteTestData,
} from "@/test/helpers";
import {
  createWebsite,
  deleteWebsite,
  getWebsite,
  listWebsites,
  setWebsiteStatus,
  updateWebsite,
} from "./service";
import type { DnsResolver } from "@/server/security/ssrf";

const userIds: string[] = [];
const organizationIds: string[] = [];
const publicIpv4 = "93.184.216.34";
const publicResolver: DnsResolver = async () => [publicIpv4];

afterAll(async () => {
  await deleteTestData({ userIds, organizationIds });
});

function uniqueHost(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.example.com`;
}

async function addMember(
  organizationId: string,
  userId: string,
  role: "ADMIN" | "MEMBER",
) {
  await database.organizationMember.create({
    data: { organizationId, userId, role },
  });
}

describe("website CRUD and authorization", () => {
  it("lets OWNER and ADMIN create, update, disable, and delete a website", async () => {
    const owner = await createTestOwner("Website Owner");
    const admin = await createTestUser("Website Admin");
    userIds.push(owner.user.id, admin.id);
    organizationIds.push(owner.organization.id);
    await addMember(owner.organization.id, admin.id, "ADMIN");

    const host = uniqueHost("owner");
    const created = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Voltios Energie",
        url: host,
      },
      { resolver: publicResolver },
    );
    expect(created.normalizedUrl).toBe(`https://${host}`);
    expect(created.status).toBe("ACTIVE");
    expect(created.id).not.toMatch(/^\d+$/);

    const byAdmin = await createWebsite(
      {
        userId: admin.id,
        organizationSlug: owner.organization.slug,
        name: "Admin Site",
        url: uniqueHost("admin"),
      },
      { resolver: publicResolver },
    );
    expect(byAdmin.name).toBe("Admin Site");

    const renamed = await updateWebsite(
      {
        userId: admin.id,
        organizationSlug: owner.organization.slug,
        websiteId: created.id,
        name: "Voltios Energie BV",
        url: created.normalizedUrl,
        status: "ACTIVE",
      },
      { resolver: publicResolver },
    );
    expect(renamed.name).toBe("Voltios Energie BV");

    const disabled = await setWebsiteStatus({
      userId: owner.user.id,
      organizationSlug: owner.organization.slug,
      websiteId: created.id,
      status: "DISABLED",
    });
    expect(disabled.status).toBe("DISABLED");

    await deleteWebsite({
      userId: admin.id,
      organizationSlug: owner.organization.slug,
      websiteId: byAdmin.id,
    });
    await expect(
      getWebsite(owner.user.id, owner.organization.slug, byAdmin.id),
    ).rejects.toBeInstanceOf(WebsiteNotFoundError);
  });

  it("lets MEMBER read websites but not create, update, or delete them", async () => {
    const owner = await createTestOwner("Website Member");
    const member = await createTestUser("Plain Website Member");
    userIds.push(owner.user.id, member.id);
    organizationIds.push(owner.organization.id);
    await addMember(owner.organization.id, member.id, "MEMBER");

    const website = await createWebsite(
      {
        userId: owner.user.id,
        organizationSlug: owner.organization.slug,
        name: "Member Visible",
        url: uniqueHost("member-read"),
      },
      { resolver: publicResolver },
    );

    const listed = await listWebsites(member.id, owner.organization.slug);
    expect(listed.some((item) => item.id === website.id)).toBe(true);

    await expect(
      createWebsite(
        {
          userId: member.id,
          organizationSlug: owner.organization.slug,
          name: "Blocked",
          url: uniqueHost("member-write"),
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      updateWebsite(
        {
          userId: member.id,
          organizationSlug: owner.organization.slug,
          websiteId: website.id,
          name: "Hacked",
          url: website.normalizedUrl,
          status: "DISABLED",
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      deleteWebsite({
        userId: member.id,
        organizationSlug: owner.organization.slug,
        websiteId: website.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("blocks outsiders and does not leak another tenant's website", async () => {
    const tenantA = await createTestOwner("Web Tenant A");
    const tenantB = await createTestOwner("Web Tenant B");
    userIds.push(tenantA.user.id, tenantB.user.id);
    organizationIds.push(tenantA.organization.id, tenantB.organization.id);

    const websiteA = await createWebsite(
      {
        userId: tenantA.user.id,
        organizationSlug: tenantA.organization.slug,
        name: "Alpha Site",
        url: uniqueHost("alpha"),
      },
      { resolver: publicResolver },
    );
    const websiteB = await createWebsite(
      {
        userId: tenantB.user.id,
        organizationSlug: tenantB.organization.slug,
        name: "Secret Beta Site",
        url: uniqueHost("beta"),
      },
      { resolver: publicResolver },
    );

    await expect(
      listWebsites(tenantA.user.id, tenantB.organization.slug),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      getWebsite(tenantA.user.id, tenantA.organization.slug, websiteB.id),
    ).rejects.toBeInstanceOf(WebsiteNotFoundError);

    await expect(
      getWebsite(tenantA.user.id, tenantB.organization.slug, websiteB.id),
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      updateWebsite(
        {
          userId: tenantA.user.id,
          organizationSlug: tenantA.organization.slug,
          websiteId: websiteB.id,
          name: "Stolen",
          url: websiteB.normalizedUrl,
          status: "DISABLED",
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(WebsiteNotFoundError);

    await expect(
      deleteWebsite({
        userId: tenantA.user.id,
        organizationSlug: tenantA.organization.slug,
        websiteId: websiteB.id,
      }),
    ).rejects.toBeInstanceOf(WebsiteNotFoundError);

    const stillB = await getWebsite(
      tenantB.user.id,
      tenantB.organization.slug,
      websiteB.id,
    );
    expect(stillB.name).toBe("Secret Beta Site");
    expect(websiteA.organizationId).not.toBe(websiteB.organizationId);
  });

  it("rejects invalid URLs, private targets, and duplicates", async () => {
    const { user, organization } = await createTestOwner("Website Validation");
    userIds.push(user.id);
    organizationIds.push(organization.id);
    const host = uniqueHost("dup");

    await createWebsite(
      {
        userId: user.id,
        organizationSlug: organization.slug,
        name: "First",
        url: `https://${host}/`,
      },
      { resolver: publicResolver },
    );

    await expect(
      createWebsite(
        {
          userId: user.id,
          organizationSlug: organization.slug,
          name: "Again",
          url: host,
        },
        { resolver: publicResolver },
      ),
    ).rejects.toMatchObject({
      message: "This website is already added to your organization.",
    });

    await expect(
      createWebsite(
        {
          userId: user.id,
          organizationSlug: organization.slug,
          name: "Local",
          url: "http://127.0.0.1",
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(UrlValidationError);

    await expect(
      createWebsite(
        {
          userId: user.id,
          organizationSlug: organization.slug,
          name: "File",
          url: "file:///etc/passwd",
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(UrlValidationError);

    await expect(
      createWebsite(
        {
          userId: user.id,
          organizationSlug: organization.slug,
          name: "Port",
          url: "https://example.com:5432",
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(UrlValidationError);
  });

  it("re-validates URL changes on update", async () => {
    const { user, organization } = await createTestOwner("Website Revalidate");
    userIds.push(user.id);
    organizationIds.push(organization.id);
    const website = await createWebsite(
      {
        userId: user.id,
        organizationSlug: organization.slug,
        name: "Safe",
        url: uniqueHost("revalidate"),
      },
      { resolver: publicResolver },
    );

    await expect(
      updateWebsite(
        {
          userId: user.id,
          organizationSlug: organization.slug,
          websiteId: website.id,
          name: "Unsafe",
          url: "http://169.254.169.254",
          status: "ACTIVE",
        },
        { resolver: publicResolver },
      ),
    ).rejects.toBeInstanceOf(UrlValidationError);

    const unchanged = await getWebsite(user.id, organization.slug, website.id);
    expect(unchanged.hostname).toBe(website.hostname);
  });

  it("allows two organizations to add the same public origin", async () => {
    const tenantA = await createTestOwner("Shared Origin A");
    const tenantB = await createTestOwner("Shared Origin B");
    userIds.push(tenantA.user.id, tenantB.user.id);
    organizationIds.push(tenantA.organization.id, tenantB.organization.id);
    const host = uniqueHost("shared");

    const first = await createWebsite(
      {
        userId: tenantA.user.id,
        organizationSlug: tenantA.organization.slug,
        name: "A",
        url: host,
      },
      { resolver: publicResolver },
    );
    const second = await createWebsite(
      {
        userId: tenantB.user.id,
        organizationSlug: tenantB.organization.slug,
        name: "B",
        url: host,
      },
      { resolver: publicResolver },
    );

    expect(first.normalizedUrl).toBe(second.normalizedUrl);
    expect(first.organizationId).not.toBe(second.organizationId);
  });
});
