import { Octokit } from "@octokit/rest";
import { config } from "../../config.js";

let _octokit: Octokit | null = null;

function octokit(): Octokit {
  if (!_octokit) {
    _octokit = new Octokit({ auth: config.github.token });
  }
  return _octokit;
}

// Test seam: allow tests to inject a mock Octokit.
export function _setOctokit(client: Octokit | null): void {
  _octokit = client;
}

export interface GithubUser {
  login: string;
  id: number;
}

export async function getUser(username: string): Promise<GithubUser | null> {
  try {
    const res = await octokit().users.getByUsername({ username });
    return { login: res.data.login, id: res.data.id };
  } catch (err) {
    if (isStatus(err, 404)) return null;
    throw err;
  }
}

export async function isOrgMember(
  org: string,
  username: string,
): Promise<boolean> {
  try {
    await octokit().orgs.checkMembershipForUser({ org, username });
    return true;
  } catch (err) {
    if (isStatus(err, 404)) return false;
    throw err;
  }
}

export async function createOrgInvitation(
  org: string,
  username: string,
): Promise<void> {
  const user = await getUser(username);
  if (!user) throw new Error(`GitHub user not found: ${username}`);
  await octokit().orgs.createInvitation({ org, invitee_id: user.id });
}

export interface CreateRepoInput {
  org: string;
  name: string;
  private?: boolean;
  description?: string;
}

export async function createOrgRepo(input: CreateRepoInput): Promise<void> {
  await octokit().repos.createInOrg({
    org: input.org,
    name: input.name,
    private: input.private ?? true,
    description: input.description,
    auto_init: true,
  });
}

export interface CreateRepoFromTemplateInput {
  templateOwner: string;
  templateRepo: string;
  org: string;
  name: string;
  private?: boolean;
}

export async function createRepoFromTemplate(
  input: CreateRepoFromTemplateInput,
): Promise<void> {
  await octokit().repos.createUsingTemplate({
    template_owner: input.templateOwner,
    template_repo: input.templateRepo,
    owner: input.org,
    name: input.name,
    private: input.private ?? true,
  });
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === status
  );
}
