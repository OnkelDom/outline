import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { CollectionGitSync } from "@server/models";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import env from "../env";

const server = getTestServer();
let tmp: string;
let remote: string;

beforeAll(() => {
  env.GIT_SYNC_ALLOW_INSECURE_URLS = true;
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "git-sync-api-"));
  env.GIT_SYNC_CACHE_DIR = path.join(tmp, "cache");
  remote = path.join(tmp, "remote.git");
  await fs.ensureDir(remote);
  execFileSync("git", ["init", "--bare", "--quiet", "--initial-branch=main"], {
    cwd: remote,
  });
});

afterEach(async () => {
  await fs.remove(tmp);
});

async function setup() {
  const admin = await buildAdmin();
  const collection = await buildCollection({
    teamId: admin.teamId,
    userId: admin.id,
  });
  return { admin, collection };
}

describe("#gitSync.create", () => {
  it("requires authentication", async () => {
    const res = await server.post("/api/gitSync.create", { body: {} });
    expect(res.status).toEqual(401);
  });

  it("requires an admin", async () => {
    const { collection } = await setup();
    const user = await buildUser({ teamId: collection.teamId });
    const res = await server.post("/api/gitSync.create", user, {
      body: { collectionId: collection.id, repositoryUrl: `file://${remote}` },
    });
    expect(res.status).toEqual(403);
  });

  it("does not allow collections of other teams", async () => {
    const { admin } = await setup();
    const other = await buildCollection();
    const res = await server.post("/api/gitSync.create", admin, {
      body: { collectionId: other.id, repositoryUrl: `file://${remote}` },
    });
    expect(res.status).toEqual(403);
  });

  it("connects a collection and hides the token", async () => {
    const { admin, collection } = await setup();
    const res = await server.post("/api/gitSync.create", admin, {
      body: {
        collectionId: collection.id,
        repositoryUrl: `file://${remote}`,
        branch: "main",
        path: "/docs/",
        token: "secret-token",
        authorEmail: "",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.collectionId).toEqual(collection.id);
    expect(body.data.path).toEqual("docs");
    expect(body.data.direction).toEqual("bidirectional");
    expect(body.data.hasToken).toBe(true);
    expect(body.data.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(body.data.webhookUrl).toContain("/api/gitSync.webhook?id=");

    const sync = await CollectionGitSync.findByPk(body.data.id);
    expect(sync?.token).toEqual("secret-token");
  });

  it("rejects a second sync for the same collection", async () => {
    const { admin, collection } = await setup();
    await server.post("/api/gitSync.create", admin, {
      body: { collectionId: collection.id, repositoryUrl: `file://${remote}` },
    });
    const res = await server.post("/api/gitSync.create", admin, {
      body: { collectionId: collection.id, repositoryUrl: `file://${remote}` },
    });
    expect(res.status).toEqual(400);
  });

  it("rejects insecure URLs and bad branches", async () => {
    const { admin, collection } = await setup();
    env.GIT_SYNC_ALLOW_INSECURE_URLS = false;
    try {
      const res = await server.post("/api/gitSync.create", admin, {
        body: {
          collectionId: collection.id,
          repositoryUrl: `file://${remote}`,
        },
      });
      expect(res.status).toEqual(400);
    } finally {
      env.GIT_SYNC_ALLOW_INSECURE_URLS = true;
    }

    const res = await server.post("/api/gitSync.create", admin, {
      body: {
        collectionId: collection.id,
        repositoryUrl: `file://${remote}`,
        branch: "bad..branch",
      },
    });
    expect(res.status).toEqual(400);
  });
});

describe("#gitSync.update", () => {
  it("keeps the token unless a new one is given", async () => {
    const { admin, collection } = await setup();
    const created = await (
      await server.post("/api/gitSync.create", admin, {
        body: {
          collectionId: collection.id,
          repositoryUrl: `file://${remote}`,
          token: "first",
        },
      })
    ).json();

    let res = await server.post("/api/gitSync.update", admin, {
      body: { id: created.data.id, branch: "docs", enabled: false },
    });
    let body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.branch).toEqual("docs");
    expect(body.data.enabled).toBe(false);
    expect(body.data.hasToken).toBe(true);

    res = await server.post("/api/gitSync.update", admin, {
      body: { id: created.data.id, token: null },
    });
    body = await res.json();
    expect(body.data.hasToken).toBe(false);
  });
});

describe("#gitSync.run and tags", () => {
  it("runs a sync, creates and lists tags", async () => {
    const { admin, collection } = await setup();
    const document = await buildDocument({
      teamId: admin.teamId,
      userId: admin.id,
      collectionId: collection.id,
      title: "Guide",
    });
    await collection.addDocumentToStructure(document);

    const created = await (
      await server.post("/api/gitSync.create", admin, {
        body: {
          collectionId: collection.id,
          repositoryUrl: `file://${remote}`,
        },
      })
    ).json();

    let res = await server.post("/api/gitSync.run", admin, {
      body: { id: created.data.id },
    });
    let body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.result.exported).toEqual(1);
    expect(body.data.status).toEqual("success");

    res = await server.post("/api/gitSync.tags.create", admin, {
      body: { id: created.data.id, name: "v1.0.0", message: "Release" },
    });
    body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.map((tag: { name: string }) => tag.name)).toEqual([
      "v1.0.0",
    ]);

    res = await server.post("/api/gitSync.tags.create", admin, {
      body: { id: created.data.id, name: "v1.0.0" },
    });
    expect(res.status).toEqual(400);

    res = await server.post("/api/gitSync.tags.list", admin, {
      body: { id: created.data.id },
    });
    body = await res.json();
    expect(body.data[0].message).toEqual("Release");

    res = await server.post("/api/gitSync.tags.delete", admin, {
      body: { id: created.data.id, name: "v1.0.0" },
    });
    body = await res.json();
    expect(body.data).toEqual([]);

    const info = await (
      await server.post("/api/gitSync.info", admin, {
        body: { collectionId: collection.id },
      })
    ).json();
    expect(info.data.id).toEqual(created.data.id);
  });
});

describe("#gitSync.webhook", () => {
  it("requires the secret", async () => {
    const { admin, collection } = await setup();
    const sync = await CollectionGitSync.create({
      repositoryUrl: `file://${remote}`,
      collectionId: collection.id,
      teamId: admin.teamId,
      createdById: admin.id,
    });

    let res = await server.post(
      `/api/gitSync.webhook?id=${sync.id}&secret=wrong`,
      { body: {} }
    );
    expect(res.status).toEqual(404);

    res = await server.post(
      `/api/gitSync.webhook?id=${sync.id}&secret=${sync.webhookSecret}`,
      { body: { ref: "refs/heads/main" } }
    );
    expect(res.status).toEqual(202);
  });
});

describe("#gitSync.delete", () => {
  it("disconnects the collection", async () => {
    const { admin, collection } = await setup();
    const created = await (
      await server.post("/api/gitSync.create", admin, {
        body: {
          collectionId: collection.id,
          repositoryUrl: `file://${remote}`,
        },
      })
    ).json();

    const other = await buildAdmin();
    let res = await server.post("/api/gitSync.delete", other, {
      body: { id: created.data.id },
    });
    expect(res.status).toEqual(404);

    res = await server.post("/api/gitSync.delete", admin, {
      body: { id: created.data.id },
    });
    expect(res.status).toEqual(200);
    expect(await CollectionGitSync.findByPk(created.data.id)).toBeNull();
  });
});
