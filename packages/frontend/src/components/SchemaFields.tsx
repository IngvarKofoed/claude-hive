import type { JsonSchema } from "@hive/shared";
import styles from "./SchemaFields.module.css";

const WORDS: Record<string, string> = {
  string: "text",
  number: "number",
  integer: "whole number",
  boolean: "yes/no",
};

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The fields to nest under a schema: its own properties, or its items' when it is a list. */
function childProperties(schema: JsonSchema): JsonSchema | null {
  if (isSchema(schema.properties)) return schema.properties;
  if (isSchema(schema.items)) return childProperties(schema.items);
  return null;
}

/** A schema's type in words: "text", "text or null", "one of done, blocked", "list of text". */
function typeWords(schema: JsonSchema): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map(String).join(", ")}`;
  const type = schema.type;
  const types = Array.isArray(type) ? type : typeof type === "string" ? [type] : [];
  if (types.length === 0) return "any";
  return types
    .map((one) => {
      if (one === "array") {
        const items = isSchema(schema.items) ? schema.items : null;
        // "list of" with the item's fields nested under it; with another type beside it, just "list".
        if (items && isSchema(items.properties)) return types.length === 1 ? "list of" : "list";
        return items ? `list of ${typeWords(items)}` : "list";
      }
      return WORDS[String(one)] ?? String(one);
    })
    .join(" or ");
}

/** A JSON schema object's properties, in order, as nested fields: name, type in words, description. */
export function SchemaFields({ schema }: { schema: JsonSchema }) {
  const properties = isSchema(schema.properties) ? schema.properties : null;
  if (!properties) return null;
  return (
    <ul className={styles.fields}>
      {Object.entries(properties).map(([name, value]) => {
        const field = isSchema(value) ? value : {};
        const nested = childProperties(field);
        return (
          <li key={name}>
            <span className={styles.name}>{name}</span> <span className={styles.type}>{typeWords(field)}</span>
            {typeof field.description === "string" && field.description !== "" && (
              <p className={styles.description}>{field.description}</p>
            )}
            {nested && <SchemaFields schema={{ properties: nested }} />}
          </li>
        );
      })}
    </ul>
  );
}
