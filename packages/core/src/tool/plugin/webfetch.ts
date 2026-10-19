export * as WebFetchTool from "./webfetch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { Cause, Duration, Effect, Exit, Schema } from "effect"
import { HttpClient, type HttpClientError, HttpClientError as HttpClientErrorClass, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Parser } from "htmlparser2"
import { Permission } from "../../permission.js"
import { convertHTMLToMarkdown, MAX_MARKDOWN_BYTES } from "../html-markdown.js"
import { collectBoundedResponseBody } from "../http-body.js"

export const name = "webfetch"
export const MAX_RESPONSE_BYTES = MAX_MARKDOWN_BYTES
export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120

/**
 * Mainland-China-friendly fallbacks for URLs whose direct fetch fails at the transport layer
 * (the failure shape of blocked networks). HuggingFace has a path-compatible community mirror
 * (hf-mirror.com) and GitHub hosts are proxied through gh-proxy.com (prefix-style); both are
 * reachable without a proxy. Other hosts have no reliable free mainland mirror, so they get
 * no fallback. Only http(s) URLs get fallbacks.
 */
export const fallbackUrls = (input: string): string[] => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return []
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return []
  if (url.hostname === "huggingface.co")
    return [`https://hf-mirror.com${url.pathname}${url.search}${url.hash}`]
  if (url.hostname === "github.com" || url.hostname.endsWith(".githubusercontent.com"))
    return [`https://gh-proxy.com/${input}`]
  return []
}

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in managed storage.`

const Timeout = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_TIMEOUT_SECONDS))

export const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("markdown" as const))),
  timeout: Schema.optionalKey(Timeout).annotate({
    description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
  }),
})

const Output = Schema.Struct({
  url: Schema.String,
  contentType: Schema.String,
  format: Input.fields.format,
  output: Schema.String,
})
type Format = (typeof Input.Type)["format"]

const acceptHeader = (format: Format) => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

const headers = (format: Format, userAgent: string) => ({
  "User-Agent": userAgent,
  Accept: acceptHeader(format),
  "Accept-Language": "en-US,en;q=0.9",
})

const openCodeUserAgent =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OpenCode-User/1.0; +https://opencode.ai"

const isCloudflareChallenge = (error: HttpClientError.HttpClientError) => {
  if (error.reason._tag !== "StatusCodeError") return false
  const response = error.reason.response
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge"
}

const request = (url: string, format: Format, userAgent = openCodeUserAgent) =>
  HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers(format, userAgent)))

const assertHttpUrl = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://")
}

const execute = (http: HttpClient.HttpClient, url: string, format: Format, userAgent = openCodeUserAgent) =>
  http.execute(request(url, format, userAgent)).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))

/** Marks a per-attempt timeout so later fallbacks can still run within the user's budget. */
class RequestTimeoutError extends Error {
  constructor() {
    super("Request timed out")
  }
}

// Only transport-level failures (blocked or unreachable networks) fall back to mirrors/relays;
// HTTP status errors mean the server answered, so a fallback URL cannot change the outcome.
// The fetch client reports transport failures as HttpClientError wrapping a TransportError reason.
const isRetriable = (error: unknown) =>
  error instanceof RequestTimeoutError ||
  (error instanceof HttpClientErrorClass.HttpClientError && error.reason._tag === "TransportError")

const fetchFrom = (http: HttpClient.HttpClient, url: string, format: Format) =>
  Effect.gen(function* () {
    const response = yield* execute(http, url, format).pipe(
      Effect.catchIf(isCloudflareChallenge, () => execute(http, url, format, "opencode")),
    )
    const contentType = response.headers["content-type"] || ""
    const mime = mimeFrom(contentType)
    if (isImageAttachment(mime))
      return yield* Effect.fail(new Error(`Unsupported fetched image content type: ${mime}`))
    if (!isTextualMime(mime))
      return yield* Effect.fail(new Error(`Unsupported fetched file content type: ${mime}`))
    return { body: yield* collectBody(response), contentType }
  })

const collectBody = (response: HttpClientResponse.HttpClientResponse) =>
  collectBoundedResponseBody(
    response,
    MAX_RESPONSE_BYTES,
    () => new Error(`Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`),
  )

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"
const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript"
const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

export const Plugin = {
  id: "opencode.tool.webfetch",
  effect: Effect.fn("WebFetchTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* Effect.try({
                try: () => assertHttpUrl(new URL(input.url)),
                catch: (error) => error,
              })

              yield* permission.assert({
                action: name,
                resources: [input.url],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })

              // Direct fetch first; mainland-friendly mirrors and relays only when the transport
              // layer fails. The user's timeout is split evenly across the attempts.
              const candidates = [input.url, ...fallbackUrls(input.url)]
              const perAttempt = Duration.millis(
                Math.max((input.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1000 / candidates.length, 250),
              )
              const attempt = (url: string) =>
                fetchFrom(http, url, input.format).pipe(
                  Effect.timeoutOrElse({ duration: perAttempt, orElse: () => Effect.fail(new RequestTimeoutError()) }),
                )

              let fetched: { body: Uint8Array; contentType: string; url: string } | undefined
              let failure: unknown
              for (const url of candidates) {
                const outcome = yield* attempt(url).pipe(Effect.exit)
                if (Exit.isSuccess(outcome)) {
                  fetched = { ...outcome.value, url }
                  break
                }
                failure = Cause.squash(outcome.cause)
                if (!isRetriable(failure)) return yield* Effect.fail(failure)
              }
              if (!fetched) return yield* Effect.fail(failure)

              const content = new TextDecoder().decode(fetched.body)
              const output = yield* Effect.try({
                try: () => convert(content, fetched.contentType, input.format),
                catch: (error) => error,
              })
              const result = {
                url: input.url,
                contentType: fetched.contentType,
                format: input.format,
                output,
              }
              return {
                output: result,
                content: result.output,
                metadata: {
                  contentType: result.contentType,
                  ...(fetched.url !== input.url ? { fetchedUrl: fetched.url } : {}),
                },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: `Unable to fetch ${input.url}`, error }))),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

export function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) skipDepth++
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })
  parser.write(html)
  parser.end()
  return text.trim()
}

export { convertHTMLToMarkdown }
