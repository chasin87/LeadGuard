"use client";

import { useMemo, useState } from "react";

const inputClassName =
  "mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm";

export type FieldMappingDraft = {
  role: string;
  control: string;
  selector: string;
  label: string;
  value: string;
};

const roles = [
  ["NAME", "Name"],
  ["EMAIL", "Email"],
  ["PHONE", "Phone"],
  ["POSTCODE", "Postcode"],
  ["HOUSE_NUMBER", "House number"],
  ["CITY", "City"],
  ["MESSAGE", "Message"],
  ["COMPANY", "Company"],
  ["LEADGUARD_SUBMISSION_ID", "Submission ID"],
  ["CUSTOM", "Custom"],
] as const;

const controls = [
  ["TEXT", "Text"],
  ["EMAIL", "Email"],
  ["TEL", "Tel"],
  ["TEXTAREA", "Textarea"],
  ["SELECT", "Select"],
  ["CHECKBOX", "Checkbox"],
  ["RADIO", "Radio"],
] as const;

export function defaultFieldMappings(): FieldMappingDraft[] {
  return [
    {
      role: "NAME",
      control: "TEXT",
      selector: 'input[name="name"]',
      label: "",
      value: "",
    },
    {
      role: "EMAIL",
      control: "EMAIL",
      selector: 'input[name="email"]',
      label: "",
      value: "",
    },
    {
      role: "MESSAGE",
      control: "TEXTAREA",
      selector: 'textarea[name="message"]',
      label: "",
      value: "",
    },
  ];
}

export function FormFieldMappingEditor({
  name = "fieldMappings",
  initial,
}: {
  name?: string;
  initial?: FieldMappingDraft[];
}) {
  const [rows, setRows] = useState<FieldMappingDraft[]>(
    initial && initial.length > 0 ? initial : defaultFieldMappings(),
  );
  const json = useMemo(() => JSON.stringify(rows), [rows]);

  return (
    <div className="space-y-3">
      <textarea name={name} value={json} readOnly hidden />
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-slate-50">
            <tr>
              <th className="px-2 py-2 font-semibold">Field</th>
              <th className="px-2 py-2 font-semibold">Type</th>
              <th className="px-2 py-2 font-semibold">Selector</th>
              <th className="px-2 py-2 font-semibold">Value</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr className="border-b border-[var(--border)]" key={index}>
                <td className="px-2 py-2 align-top">
                  <select
                    className={inputClassName}
                    value={row.role}
                    onChange={(event) =>
                      update(index, { role: event.target.value })
                    }
                  >
                    {roles.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 align-top">
                  <select
                    className={inputClassName}
                    value={row.control}
                    onChange={(event) =>
                      update(index, { control: event.target.value })
                    }
                  >
                    {controls.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 align-top">
                  <input
                    className={inputClassName}
                    value={row.selector}
                    onChange={(event) =>
                      update(index, { selector: event.target.value })
                    }
                    placeholder='input[name="email"]'
                  />
                </td>
                <td className="px-2 py-2 align-top">
                  <input
                    className={inputClassName}
                    value={row.value}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                    placeholder={
                      row.control === "CHECKBOX"
                        ? "checks this box"
                        : "Profile or explicit value"
                    }
                  />
                </td>
                <td className="px-2 py-2 align-top">
                  <button
                    className="mt-2 text-sm font-semibold text-red-700"
                    type="button"
                    onClick={() =>
                      setRows((current) =>
                        current.filter((_, item) => item !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="text-sm font-semibold text-[#19d0a2]"
        type="button"
        onClick={() =>
          setRows((current) => [
            ...current,
            {
              role: "CUSTOM",
              control: "TEXT",
              selector: "",
              label: "",
              value: "",
            },
          ])
        }
      >
        Add field
      </button>
    </div>
  );

  function update(index: number, patch: Partial<FieldMappingDraft>) {
    setRows((current) =>
      current.map((row, item) => (item === index ? { ...row, ...patch } : row)),
    );
  }
}
