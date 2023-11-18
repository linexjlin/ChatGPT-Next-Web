import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";
import { DEFAULT_MODELS, OPENAI_BASE_URL } from "../constant";
import { collectModelTable } from "../utils/model";
import { makeAzurePath } from "../azure";

const CHAGLM_URL = process.env.CHAGLM_URL ?? "http://112.4.97.55:8001";

export const OPENAI_URL = "api.openai.com";
const DEFAULT_PROTOCOL = "https";
const PROTOCOL = process.env.PROTOCOL || DEFAULT_PROTOCOL;
const BASE_URL = process.env.BASE_URL || OPENAI_URL;
const DISABLE_GPT4 = !!process.env.DISABLE_GPT4;

//key = 'xwxxxxx' or key = 'sk-xxxx' 进入openai
//key 随意 用chatglm
function getValues(k: string, p: string): [string, string, string] {
  let provider = "openai";
  let url = "";
  let key = "" + k;
  let path = "";

  if (k == "" || k.endsWith("chatglm")) {
    provider = "chatglm";
    key = "Bearer " + process.env.CHAGLM_TOKEN;
  }

  if (k.startsWith("Bearer " + process.env.TEST_PREFIX)) {
    key = "Bearer " + process.env.OPENAI_API_KEY_TEST;
  }

  switch (provider) {
    case "openai":
      url = BASE_URL;
      path = p.replaceAll("/api/openai/", "");
      break;
    case "chatglm":
      url = CHAGLM_URL;
      path = "v1/chat/completions";
      break;
  }

  return [url, key, path];
}

export async function requestOpenai(req: NextRequest) {
  const [url, key, path] = getValues(
    "" + req.headers.get("Authorization"),
    `${req.nextUrl.pathname}${req.nextUrl.search}`,
  );
  console.log("[Test]", url, key, path);

  const controller = new AbortController();
  const authValue = key;
  const openaiPath = path;

  let baseUrl = url;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);
  console.log("[Org ID]", serverConfig.openaiOrgId);

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10 * 60 * 1000);

  if (serverConfig.isAzure) {
    if (!serverConfig.azureApiVersion) {
      return NextResponse.json({
        error: true,
        message: `missing AZURE_API_VERSION in server env vars`,
      });
    }
    path = makeAzurePath(path, serverConfig.azureApiVersion);
  }

  const fetchUrl = `${baseUrl}/${path}`;
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      [authHeaderName]: authValue,
      ...(serverConfig.openaiOrgId && {
        "OpenAI-Organization": serverConfig.openaiOrgId,
      }),
    },
    method: req.method,
    body: req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  // #1815 try to refuse gpt4 request
  if (serverConfig.customModels && req.body) {
    try {
      const modelTable = collectModelTable(
        DEFAULT_MODELS,
        serverConfig.customModels,
      );
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody) as { model?: string };

      // not undefined and is false
      if (modelTable[jsonBody?.model ?? ""].available === false) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error("[OpenAI] gpt4 filter", e);
    }
  }

  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
