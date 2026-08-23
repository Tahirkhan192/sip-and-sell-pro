/**
 * The small window Google sends back to after the account is allowed.
 * It hands the one-time code to the Settings page and closes itself.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/oauth/google-drive/return")({
  component: OAuthReturn,
  head: () => ({
    meta: [
      { title: "Connecting Google Drive — Khyber Delicious Food" },
      { name: "description", content: "Finishing the Google Drive connection for backup and restore." },
      { property: "og:title", content: "Connecting Google Drive" },
      { property: "og:description", content: "Finishing the Google Drive connection for backup and restore." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function OAuthReturn() {
  const [message, setMessage] = useState("Finishing the connection…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const finish = (type: "ok" | "failed", code?: string) => {
      window.opener?.postMessage(
        { type: type === "ok" ? "driveConnectComplete" : "driveConnectFailed", code: code ?? null },
        window.location.origin,
      );
      window.close();
    };
    if (params.get("success") !== "true") {
      setMessage(params.get("error") ?? "Google did not complete the connection.");
      finish("failed");
      return;
    }
    const code = params.get("code");
    if (!code) {
      setMessage("Google finished without a code.");
      finish("failed");
      return;
    }
    finish("ok", code);
  }, []);

  return <p className="p-6 text-sm">{message}</p>;
}
