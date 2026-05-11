import * as orgClient from "../integrations/github/orgClient.js";
import { config } from "../config.js";

const RESERVED_REPO_NAMES = new Set(["admin", "owner", "template", ".github"]);

export interface InviteResult {
  status: "invited" | "already_member" | "user_not_found";
  username: string;
}

export async function inviteUser(username: string): Promise<InviteResult> {
  const cleaned = username.trim().replace(/^@/, "");
  if (!cleaned) return { status: "user_not_found", username };

  const user = await orgClient.getUser(cleaned);
  if (!user) return { status: "user_not_found", username: cleaned };

  const member = await orgClient.isOrgMember(config.github.org, cleaned);
  if (member) return { status: "already_member", username: cleaned };

  await orgClient.createOrgInvitation(config.github.org, cleaned);
  return { status: "invited", username: cleaned };
}

export interface BulkInviteResult {
  invited: string[];
  already_member: string[];
  already_invited: string[];
  user_not_found: string[];
  failed: { username: string; reason: string }[];
}

export async function inviteMany(
  usernames: string[],
): Promise<BulkInviteResult> {
  const result: BulkInviteResult = {
    invited: [],
    already_member: [],
    already_invited: [],
    user_not_found: [],
    failed: [],
  };

  const cleaned = Array.from(
    new Set(
      usernames
        .map((u) => u.trim().replace(/^@/, "").toLowerCase())
        .filter((u) => u.length > 0),
    ),
  );
  if (cleaned.length === 0) return result;

  const org = config.github.org;
  const [members, pending] = await Promise.all([
    orgClient.listMembers(org),
    orgClient.listPendingInvitations(org),
  ]);
  const memberSet = new Set(members);
  const pendingLogins = new Set(
    pending.map((p) => p.login).filter((l): l is string => l !== null),
  );

  for (const username of cleaned) {
    if (memberSet.has(username)) {
      result.already_member.push(username);
      continue;
    }
    if (pendingLogins.has(username)) {
      result.already_invited.push(username);
      continue;
    }
    try {
      const user = await orgClient.getUser(username);
      if (!user) {
        result.user_not_found.push(username);
        continue;
      }
      await orgClient.createInvitationByUserId(org, user.id);
      result.invited.push(user.login);
    } catch (err) {
      result.failed.push({
        username,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export interface CreateRepoOptions {
  name: string;
  private?: boolean;
  template?: boolean;
  description?: string;
}

export interface CreateRepoResult {
  status: "created" | "invalid_name" | "reserved_name";
  url?: string;
  reason?: string;
}

const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

export async function createRepo(
  opts: CreateRepoOptions,
): Promise<CreateRepoResult> {
  const name = opts.name.trim();
  if (!REPO_NAME_RE.test(name)) {
    return { status: "invalid_name", reason: "허용되지 않는 이름" };
  }
  if (RESERVED_REPO_NAMES.has(name.toLowerCase())) {
    return { status: "reserved_name", reason: "예약어" };
  }

  if (
    opts.template &&
    config.github.templateOwner &&
    config.github.templateRepo
  ) {
    await orgClient.createRepoFromTemplate({
      templateOwner: config.github.templateOwner,
      templateRepo: config.github.templateRepo,
      org: config.github.org,
      name,
      private: opts.private,
    });
  } else {
    await orgClient.createOrgRepo({
      org: config.github.org,
      name,
      private: opts.private,
      description: opts.description,
    });
  }

  return {
    status: "created",
    url: `https://github.com/${config.github.org}/${name}`,
  };
}
