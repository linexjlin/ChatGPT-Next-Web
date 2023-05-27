import { log } from "console";
import { NextRequest } from "next/server";

export const OPENAI_URL = "api.openai.com";
const CHAGLM_URL = process.env.CHAGLM_URL ?? "http://112.4.97.55:8001";

const DEFAULT_PROTOCOL = "https";
const PROTOCOL = process.env.PROTOCOL ?? DEFAULT_PROTOCOL;
const BASE_URL = process.env.BASE_URL ?? OPENAI_URL;

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
    baseUrl = `${PROTOCOL}://${baseUrl}`;
  }

  console.log("[Proxy] ", openaiPath);
  console.log("[Base Url]", baseUrl);

  if (process.env.OPENAI_ORG_ID) {
    console.log("[Org ID]", process.env.OPENAI_ORG_ID);
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10 * 60 * 1000);

  const fetchUrl = `${baseUrl}/${openaiPath}`;
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Authorization: authValue,
      ...(process.env.OPENAI_ORG_ID && {
        "OpenAI-Organization": process.env.OPENAI_ORG_ID,
      }),
    },
    cache: "no-store",
    method: req.method,
    body: req.body,
    signal: controller.signal,
  };

  try {
    const res = await fetch(fetchUrl, fetchOptions);

    if (res.status === 401) {
      // to prevent browser prompt for credentials
      const newHeaders = new Headers(res.headers);
      newHeaders.delete("www-authenticate");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: newHeaders,
      });
    }

    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}
