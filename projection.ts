import type { BbPluginApi } from "@get-bb/plugin-sdk";
type Rows = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["timeline"]>
>["rows"];
export type SharedRow = { id: string; role: string; text: string };
/** Explicit allowlist: no attachments, tool arguments/results, reasoning or host paths. */
export function projectRows(rows: Rows): SharedRow[] {
  const result: SharedRow[] = [];
  function visit(items: Rows) {
    for (const row of items) {
      if (row.kind === "turn") {
        if (row.children) visit(row.children);
      } else if (row.kind === "conversation") {
        if (row.role === "user" && row.initiator !== "user") continue;
        result.push({
          id: row.id,
          role: row.role,
          text: row.text.slice(0, 40_000),
        });
      } else if (row.kind === "work") {
        result.push({
          id: row.id,
          role: "activity",
          text: `${row.workKind} · ${row.status}`,
        });
      }
    }
  }
  visit(rows);
  return result.slice(-200);
}
