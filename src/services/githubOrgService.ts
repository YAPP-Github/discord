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
