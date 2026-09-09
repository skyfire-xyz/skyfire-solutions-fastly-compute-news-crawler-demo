"use client"

import { useState } from "react"

import PageLayout from "../components/PageLayout"
import TopBar from "../components/TopBar"

const PROTECTED_URL = process.env.NEXT_PUBLIC_TARGET_SITE || ""

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute right-3 top-3 flex items-center gap-1 rounded bg-gray-700 px-3 py-1 text-xs text-white transition hover:bg-gray-600"
      title="Copy to clipboard"
    >
      {copied ? (
        <>
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          Copy
        </>
      )}
    </button>
  )
}

export default function DIYPage() {
  const step1Curl = `curl "${PROTECTED_URL}"`

  const step3Curl = `curl --request POST \\
  --url https://api.skyfire.xyz/api/v1/tokens \\
  --header 'skyfire-api-key: YOUR_API_KEY' \\
  --header 'content-type: application/json' \\
  --data '{
  "type": "kya",
  "buyerTag": "",
  "sellerServiceId": "51bcabe1-c699-474e-bc35-9840b248da52"
}'`

  const step4Curl = `curl "${PROTECTED_URL}" \\
  -H "skyfire-pay-id: KYA_TOKEN"`

  return (
    <>
      <TopBar />
      <PageLayout>
        <div className="bg-blue-10 rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="mx-auto w-full max-w-5xl">
            <h1 className="mb-8 text-3xl font-semibold text-gray-900">
              Do It Yourself (curl instructions)
            </h1>

            {/* Step 1 */}
            <div className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-gray-900">
                Step 1: Try accessing protected website without token
              </h2>
              <p className="mb-4 text-gray-600">
                This demonstrates that the protected website blocks requests
                without proper authentication. You&apos;ll receive a 403
                error response - Missing KYA token `skyfire-pay-id`. Please create an account at https://app.skyfire.xyz and create a KYA token - https://docs.skyfire.xyz/reference/create-token.
              </p>
              <div className="relative overflow-x-auto rounded-lg bg-gray-900 p-6 font-mono text-sm text-green-400">
                <CopyButton text={step1Curl} />
                <pre className="whitespace-pre-wrap break-all pr-20">
                  {step1Curl}
                </pre>
              </div>
            </div>

            {/* Step 2 */}
            <div className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-gray-900">
                Step 2: Create Skyfire account and get Buyer Agent API key
              </h2>
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-md">
                <ol className="list-inside list-decimal space-y-3 text-gray-700">
                  <li>
                    Go to{" "}
                    <a
                      href="https://app.skyfire.xyz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      app.skyfire.xyz
                    </a>{" "}
                    and create an account (if you don&apos;t have one)
                  </li>
                  <li>Navigate to the API Keys section in your dashboard</li>
                  <li>
                    Create a new <strong>Buyer Agent API key</strong>
                  </li>
                  <li>
                    Copy the API key and save it securely - you&apos;ll need it
                    for the next step
                  </li>
                  <li>
                    For detailed instructions, refer to the{" "}
                    <a
                      href="https://docs.skyfire.xyz/docs/introduction"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      Skyfire Platform Guide
                    </a>
                  </li>
                </ol>
              </div>
            </div>

            {/* Step 3 */}
            <div className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-gray-900">
                Step 3: Create KYA token via Skyfire API
              </h2>
              <p className="mb-4 text-gray-600">
                Call the Skyfire API directly to create a KYA (Know Your Agent)
                token. This token will be used to authenticate your requests and grant
                access to the protected website. Replace{" "}
                <code className="rounded bg-gray-200 px-1">YOUR_API_KEY</code>{" "}
                with your Buyer Agent API key from Step 2.
              </p>
              <div className="relative overflow-x-auto rounded-lg bg-gray-900 p-6 font-mono text-sm text-green-400">
                <CopyButton text={step3Curl} />
                <pre className="whitespace-pre-wrap break-all pr-20">
                  {step3Curl}
                </pre>
              </div>
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="mb-2 text-sm text-blue-800">
                  <strong>Parameters explained:</strong>
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-blue-800">
                  <li>
                    <code className="rounded bg-white px-1">type</code>: Set to
                    &quot;kya&quot; for Know Your Agent token
                  </li>
                  <li>
                    <code className="rounded bg-white px-1">buyerTag</code>:
                    Optional identifier for your organization
                  </li>
                  <li>
                    <code className="rounded bg-white px-1">
                      sellerServiceId
                    </code>
                    : Crawler service ID
                  </li>
                </ul>
              </div>
              <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-sm text-yellow-800">
                  <strong>Expected Response:</strong> You&apos;ll receive a JSON
                  response containing a token field. Copy the entire JWT token
                  value for use in Step 4.
                </p>
                <code className="mt-2 block rounded border bg-white p-2 text-sm text-gray-800">
                  {`{ "token": "eyJhbGciOiJFUzI1NiIsImtpZCI6IjAiLCJ0eXAiOiJreWErSldUIn0..." }`}
                </code>
              </div>
            </div>

            {/* Step 4 */}
            <div className="mb-8">
              <h2 className="mb-3 text-xl font-semibold text-gray-900">
                Step 4: Access protected website with token
              </h2>
              <p className="mb-4 text-gray-600">
                Now use the KYA token from Step 3 to access the protected website.
                Replace{" "}
                <code className="rounded bg-gray-200 px-1">KYA_TOKEN</code> with
                the actual KYA token you received. The request will successfully
                access the protected site using the{" "}
                <code className="rounded bg-gray-200 px-1">skyfire-pay-id</code>{" "}
                header.
              </p>
              <div className="relative overflow-x-auto rounded-lg bg-gray-900 p-6 font-mono text-sm text-green-400">
                <CopyButton text={step4Curl} />
                <pre className="whitespace-pre-wrap break-all pr-20">
                  {step4Curl}
                </pre>
              </div>
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm text-blue-800">
                  <strong>Important:</strong> The{" "}
                  <code className="rounded bg-white px-1">skyfire-pay-id</code>{" "}
                  header contains your KYA token and authenticates your request
                  to the protected service. This header is automatically
                  validated by Fastly Compute to verify your
                  agent&apos;s identity and authorization.
                </p>
              </div>
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-sm text-green-800">
                  <strong>Success!</strong> With a valid KYA token in the{" "}
                  <code className="rounded bg-white px-1">skyfire-pay-id</code>{" "}
                  header, you can now access the protected website and retrieve
                  the data. You should receive the HTML content of the page
                  instead of a 403 error.
                </p>
              </div>
            </div>

            {/* Summary */}
            <div className="mt-8 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
              <h3 className="mb-3 text-xl font-semibold text-gray-900">
                🎉 You&apos;ve completed the DIY tutorial!
              </h3>
              <p className="mb-4 text-gray-700">
                You&apos;ve successfully learned how to:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Create a Skyfire Buyer Agent API key</li>
                <li>Generate KYA tokens for authentication</li>
                <li>
                  Use tokens to access protected websites programmatically
                </li>
              </ul>
              <div className="mt-4 border-t border-blue-200 pt-4">
                <p className="text-sm text-gray-600">
                  For more advanced usage and integration options, visit the{" "}
                  <a
                    href="https://docs.skyfire.xyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    Skyfire Documentation
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    </>
  )
}
