import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { LANES, type RoleInfo } from "@hive/shared";
import { api } from "../api/client";
import { Header } from "../components/Header";
import { SchemaFields } from "../components/SchemaFields";
import { Chip } from "../components/ui/Chip";
import { Markdown } from "../components/ui/Markdown";
import { Panel } from "../components/ui/Panel";
import styles from "./RolePrompts.module.css";

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const displayName = (name: string) => capitalise(name.replace(/-/g, " "));
const laneName = (lane: RoleInfo["lane"]) => (lane ? (LANES.find((l) => l.id === lane)?.name ?? lane) : "Across lanes");

/** Groups consecutive roles by lane; the backend has already put them in display order. */
function group(roles: RoleInfo[]): { label: string; roles: RoleInfo[] }[] {
  const groups: { label: string; roles: RoleInfo[] }[] = [];
  for (const role of roles) {
    const label = laneName(role.lane);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.roles.push(role);
    else groups.push({ label, roles: [role] });
  }
  return groups;
}

function RolePanel({ role }: { role: RoleInfo }) {
  const title = displayName(role.name);
  const written = !role.error && !role.planned;
  const heading = (
    <div className={styles.head}>
      <h2 className={styles.roleName}>{title}</h2>
      {role.lane && <Chip>{laneName(role.lane)} lane</Chip>}
      {written && role.model && <Chip>{capitalise(role.model)}</Chip>}
      {written && role.kind && <Chip>{capitalise(role.kind)} session</Chip>}
      {written && <span className={styles.path}>roles/{role.name}.md</span>}
    </div>
  );
  if (role.error) {
    return (
      <Panel className={styles.panel} aria-label={title}>
        {heading}
        <p className={styles.error}>{role.error}</p>
      </Panel>
    );
  }
  if (role.planned) {
    return (
      <Panel className={styles.panel} aria-label={title}>
        {heading}
        <p className={styles.note}>
          Not written yet: there's no <code className={styles.code}>roles/{role.name}.md</code>. It comes with its
          lane's slice.
        </p>
      </Panel>
    );
  }
  return (
    <Panel className={styles.panel} aria-label={title}>
      {heading}
      <Markdown>{role.instructions}</Markdown>
      {role.extras.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Also appended</h3>
          {role.extras.map((path) => (
            <div key={path} className={styles.item}>
              <span className={styles.path}>{path}</span>
              <p className={styles.description}>Appended after the instructions, from your spec-format skill.</p>
            </div>
          ))}
        </section>
      )}
      {role.report && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Report</h3>
          <p className={styles.description}>Each turn ends with this report, checked against its schema.</p>
          <SchemaFields schema={role.report} />
        </section>
      )}
      {role.tools.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Hive tools</h3>
          {role.tools.map((tool) => (
            <div key={tool.name} className={styles.item}>
              <span className={styles.toolName}>{tool.name}</span>
              <p className={styles.description}>{tool.description}</p>
              <SchemaFields schema={tool.input} />
            </div>
          ))}
        </section>
      )}
    </Panel>
  );
}

export function RolePrompts() {
  const { name } = useParams();
  const [roles, setRoles] = useState<RoleInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .roles()
      .then((response) => {
        if (current) setRoles(response.roles);
      })
      .catch((err) => {
        if (current) setError(err instanceof Error ? err.message : "Could not load the roles.");
      });
    return () => {
      current = false;
    };
  }, []);

  const selected = roles ? (name === undefined ? roles[0] : roles.find((r) => r.name === name)) : undefined;

  return (
    <>
      <Header />
      <main className={styles.main}>
        <div>
          <h1 className={styles.title}>Role prompts</h1>
          <p className={styles.subtitle}>
            What each lane's sessions are told when they start, read from <code className={styles.code}>roles/</code>{" "}
            as it is now. A session already running keeps the text it started with.
          </p>
          <p className={styles.subtitle}>
            Added to the end of Claude Code's own system prompt. Your CLAUDE.md and settings still apply. What the card
            needs comes in the session's first message.
          </p>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {roles && (
          <div className={styles.layout}>
            <nav aria-label="Roles" className={styles.list}>
              {group(roles).map((g) => (
                <div key={g.label} className={styles.group}>
                  <span className={styles.groupLabel}>{g.label}</span>
                  {g.roles.map((role) => (
                    <Link
                      key={role.name}
                      to={`/roles/${encodeURIComponent(role.name)}`}
                      className={styles.entry}
                      aria-current={selected === role ? "page" : undefined}
                      data-planned={role.planned || undefined}
                    >
                      <span className={styles.entryName}>{displayName(role.name)}</span>
                      {(role.error || role.planned) && (
                        <span className={styles.entryMeta}>{role.error ?? "Not written yet"}</span>
                      )}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
            {selected ? (
              <RolePanel role={selected} />
            ) : (
              <Panel className={styles.panel}>
                <p className={styles.note}>
                  {name === undefined ? "There are no roles yet." : `There's no role called ${name}.`}
                </p>
              </Panel>
            )}
          </div>
        )}
      </main>
    </>
  );
}
