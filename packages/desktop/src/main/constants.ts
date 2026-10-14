import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "OpenCodeDesktop Dev",
  beta: "OpenCodeDesktop Beta",
  prod: "OpenCodeDesktop",
}

const appIDs: Record<string, string> = {
  dev: "com.opencodedesktop.app.dev",
  beta: "com.opencodedesktop.app.beta",
  prod: "com.opencodedesktop.app",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "OpenCodeDesktop Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "com.opencodedesktop.app.dev"
