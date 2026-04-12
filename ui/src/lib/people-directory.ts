import type { Agent, Project } from "@paperclipai/shared";
import type { CompanyMemberDirectoryEntry } from "@paperclipai/shared";
import type { InlineEntityOption } from "@/components/InlineEntitySelector";
import type { MentionOption } from "@/components/MarkdownEditor";

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sortByNameThenEmail(left: { name: string; email: string | null }, right: { name: string; email: string | null }) {
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) return byName;
  return (left.email ?? "").localeCompare(right.email ?? "");
}

export function formatHumanDisplayName(member: { name: string; email: string | null }): string {
  const email = normalizeEmail(member.email);
  return email ? `${member.name} (${email})` : member.name;
}

export function buildHumanAssigneeOptions(
  members: CompanyMemberDirectoryEntry[] | undefined,
): InlineEntityOption[] {
  return [...(members ?? [])]
    .filter((member) => member.id !== "local-board")
    .sort(sortByNameThenEmail)
    .map((member) => ({
      id: `user:${member.id}`,
      label: formatHumanDisplayName(member),
      searchText: `${member.name} ${member.email ?? ""} human`,
      group: "Human",
    }));
}

export function buildAgentAssigneeOptions(agents: Agent[] | undefined): InlineEntityOption[] {
  return [...(agents ?? [])]
    .filter((agent) => agent.status !== "terminated")
    .sort((left, right) => sortByNameThenEmail({ name: left.name, email: null }, { name: right.name, email: null }))
    .map((agent) => ({
      id: `agent:${agent.id}`,
      label: agent.name,
      searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`.trim(),
      group: "Agents",
    }));
}

export function buildAssigneeOptions(
  members: CompanyMemberDirectoryEntry[] | undefined,
  agents: Agent[] | undefined,
): InlineEntityOption[] {
  return [
    ...buildHumanAssigneeOptions(members),
    ...buildAgentAssigneeOptions(agents),
  ];
}

export function buildMentionOptions(input: {
  members?: CompanyMemberDirectoryEntry[];
  agents?: Agent[];
  projects?: Project[];
  includeProjects?: boolean;
}): MentionOption[] {
  const options: MentionOption[] = [];
  const members = [...(input.members ?? [])]
    .filter((member) => member.id !== "local-board")
    .sort(sortByNameThenEmail);
  const agents = [...(input.agents ?? [])]
    .filter((agent) => agent.status !== "terminated")
    .sort((left, right) => left.name.localeCompare(right.name));
  const projects = [...(input.projects ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const member of members) {
    options.push({
      id: `user:${member.id}`,
      name: member.name,
      label: formatHumanDisplayName(member),
      searchText: `${member.name} ${member.email ?? ""} human`,
      kind: "user",
      userId: member.id,
      userEmail: normalizeEmail(member.email),
      group: "Human",
    });
  }

  for (const agent of agents) {
    options.push({
      id: `agent:${agent.id}`,
      name: agent.name,
      label: agent.name,
      searchText: `${agent.name} ${agent.role} ${agent.title ?? ""}`.trim(),
      kind: "agent",
      agentId: agent.id,
      agentIcon: agent.icon,
      group: "Agents",
    });
  }

  if (input.includeProjects !== false) {
    for (const project of projects) {
      options.push({
        id: `project:${project.id}`,
        name: project.name,
        label: project.name,
        searchText: project.description ?? "",
        kind: "project",
        projectId: project.id,
        projectColor: project.color,
        group: "Projects",
      });
    }
  }

  return options;
}
