import { Rpc } from "@opencode/plugin/rpc"

export type ReportStatus = "success" | "partial" | "failed" | "info"

export interface ReportImage {
  /** Path relative to the report directory, as used in the stored markdown. */
  readonly file: string
  readonly alt: string
  readonly mime: string
  readonly width: number
  readonly height: number
  /** Where the agent took the image from. */
  readonly source: string
}

export interface ReportSummary {
  readonly id: string
  readonly sessionID: string
  readonly title: string
  readonly status: ReportStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly imageCount: number
}

export interface Report extends ReportSummary {
  readonly markdown: string
  readonly images: readonly ReportImage[]
  /** Absolute report directory on the server's machine. */
  readonly dir: string
}

export interface ReportChanged {
  readonly sessionID: string
  readonly reportID: string
  readonly title: string
  readonly created: boolean
}

const object = { type: "object" } as const
const ref = {
  type: "object",
  properties: { sessionID: { type: "string" }, reportID: { type: "string" } },
  required: ["sessionID", "reportID"],
} as const

export const ResultRpc = Rpc.define({
  id: "result",
  methods: {
    list: {
      input: {
        type: "object",
        properties: { sessionIDs: { type: "array", items: { type: "string" } } },
        required: ["sessionIDs"],
      },
      output: { type: "object", properties: { reports: { type: "array", items: object } }, required: ["reports"] },
    },
    get: {
      input: ref,
      output: { type: "object", properties: { report: object } },
    },
    image: {
      input: { ...ref, properties: { ...ref.properties, file: { type: "string" } }, required: [...ref.required, "file"] },
      output: { type: "object", properties: { data: { type: "string" } } },
    },
    remove: {
      input: ref,
      output: object,
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          reportID: { type: "string" },
          title: { type: "string" },
          created: { type: "boolean" },
        },
        required: ["sessionID", "reportID", "title", "created"],
      },
    },
  },
})
