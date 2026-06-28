export const API_ENDPOINTS = {
  auth: {
    login: "/auth/login",
    register: "/auth/register",
    refresh: "/auth/refresh",
    me: "/auth/me",
    logout: "/auth/logout",
    ssoExchange: "/auth/sso/exchange",
  },

  users: {
    list: "/users",
    search: "/users/search",
    password: "/users/me/password",
    preferences: "/users/me/preferences",
    detail: (id: string) => `/users/${id}`,
    update: (id: string) => `/users/${id}`,
    deactivate: (id: string) => `/users/${id}`,
    deletePermanently: (id: string) => `/users/${id}/permanent`,
  },

  roles: {
    list: "/roles",
    detail: (id: string) => `/roles/${id}`,
    create: "/roles",
    update: (id: string) => `/roles/${id}`,
    delete: (id: string) => `/roles/${id}`,
    addMember: (roleId: string) => `/roles/${roleId}/members`,
    removeMember: (roleId: string, userId: string) =>
      `/roles/${roleId}/members/${userId}`,
    menuPermissions: (roleId: string) => `/roles/${roleId}/menu-permissions`,
    autoGroup: (roleId: string) => `/roles/${roleId}/auto-group`,
  },

  permissions: {
    menu: "/permissions/menu",
  },

  groups: {
    list: "/groups",
    detail: (id: string) => `/groups/${id}`,
    create: "/groups",
    update: (id: string) => `/groups/${id}`,
    delete: (id: string) => `/groups/${id}`,
    members: (id: string) => `/groups/${id}/members`,
    addMember: (id: string) => `/groups/${id}/members`,
    removeMember: (id: string, userId: string) =>
      `/groups/${id}/members/${userId}`,
  },

  documents: {
    list: "/documents",
    detail: (id: string) => `/documents/${id}`,
    upload: "/documents/upload",
    uploadFolder: "/documents/upload-folder",
    delete: (id: string) => `/documents/${id}`,
    bulkDelete: "/documents/bulk",
    update: (id: string) => `/documents/${id}`,
    move: (id: string) => `/documents/${id}/move`,
    star: (id: string) => `/documents/${id}/star`,
    trash: "/documents/trash",
    trashBulkDelete: "/documents/trash/bulk",
    restore: (id: string) => `/documents/${id}/restore`,
    permanentDelete: (id: string) => `/documents/${id}/permanent`,
    process: (id: string) => `/documents/${id}/process`,
    processStatus: (id: string) => `/documents/${id}/process/status`,
    thumbnail: (id: string) => `/documents/${id}/thumbnail`,
    preview: (id: string) => `/documents/${id}/preview`,
    previewPdf: (id: string) => `/documents/${id}/preview-pdf`,
    download: (id: string) => `/documents/${id}/download`,
    permissions: (id: string) => `/documents/${id}/permissions`,
    permission: (id: string, permId: string) =>
      `/documents/${id}/permissions/${permId}`,
  },

  folders: {
    list: "/folders",
    detail: (id: string) => `/folders/${id}`,
    create: "/folders",
    update: (id: string) => `/folders/${id}`,
    delete: (id: string) => `/folders/${id}`,
    permissions: (id: string) => `/folders/${id}/permissions`,
    permission: (id: string, permId: string) =>
      `/folders/${id}/permissions/${permId}`,
  },

  chat: {
    sessions: "/chat/sessions",
    session: (id: string) => `/chat/sessions/${id}`,
    messages: (sessionId: string) => `/chat/sessions/${sessionId}/messages`,
  },

  templates: {
    list: "/templates",
    detail: (id: string) => `/templates/${id}`,
    fields: (id: string) => `/templates/${id}/fields`,
    file: (id: string) => `/templates/${id}/file`,
    extract: (documentId: string) => `/templates/${documentId}/extract`,
    extractDraft: (documentId: string) =>
      `/templates/${documentId}/extract-draft`,
    draft: (documentId: string) => `/templates/${documentId}/draft`,
    commit: (documentId: string) => `/templates/${documentId}/commit`,
  },

  aiModelConfigs: {
    list: "/ai-model-configs",
    public: "/ai-model-configs/public",
    test: "/ai-model-configs/test",
    detail: (id: string) => `/ai-model-configs/${id}`,
    setDefault: (id: string) => `/ai-model-configs/${id}/set-default`,
  },

  googleDrive: {
    import: "/google-drive/import",
    imports: "/google-drive/imports",
    importDetail: (id: string) => `/google-drive/imports/${id}`,
  },

  storage: {
    uploadLimits: "/storage/upload-limits",
    testConnection: "/storage/test-connection",
    configs: "/storage/configs",
    configDetail: (id: string) => `/storage/configs/${id}`,
    setDefault: (id: string) => `/storage/configs/${id}/set-default`,
    myConfigs: "/storage/my-configs",
    myConfigDetail: (id: string) => `/storage/my-configs/${id}`,
  },

  system: {
    publicConfigs: "/system/configs/public",
    configs: "/system/configs",
    configDetail: (key: string) => `/system/configs/${key}`,
    skillModelConfig: "/system/skill-model-config",
    branding: "/system/branding",
    brandingReset: "/system/branding/reset",
    storageQuota: "/system/storage-quota",
  },

  upload: {
    logo: "/upload/logo",
    favicon: "/upload/favicon",
    deleteFile: "/upload/file",
  },

  tasks: {
    list: "/tasks",
    ping: "/tasks/ping",
    detail: (id: string) => `/tasks/${id}`,
  },

  generator: {
    generate: "/generator/generate",
    renderPdf: "/generator/render-pdf",
    history: "/generator/history",
    draft: "/generator/draft",
    revise: "/generator/revise",
    mapColumns: "/generator/map-columns",
    batch: "/generator/batch",
    draftToTemplate: "/generator/draft-to-template",
    extractFromFile: "/generator/extract-from-file",
    extractFromText: "/generator/extract-from-text",
    fieldPresets: "/generator/field-presets",
  },

  ops: {
    excelPreview: "/ops/excel/preview",
    excelSplit: "/ops/excel/split",
  },

  dashboard: {
    stats: "/dashboard/stats",
    recentFiles: "/dashboard/recent-files",
    processingData: "/dashboard/processing-data",
    sharedFiles: "/dashboard/shared-files",
    report: "/dashboard/report",
  },

  review: {
    start: "/review/start",
    result: (jobId: string) => `/review/result/${jobId}`,
    documentText: (docId: string) => `/review/document-text/${docId}`,
    documentNumbering: (docId: string) => `/review/document-numbering/${docId}`,
    quickAction: "/review/start/quick-action",
    jobs: "/review/jobs",
    history: "/review/history",
    historyItem: (jobId: string) => `/review/history/${jobId}`,
    trackedChangesDocx: (jobId: string) =>
      `/review/result/${jobId}/tracked-changes.docx`,
    evalReportPdf: (jobId: string) => `/review/result/${jobId}/eval-report.pdf`,
    suggestChecklist: "/review/suggest-checklist",
    historyItemStatus: (jobId: string) => `/review/history/${jobId}/status`,
    jobVersions: (jobId: string) => `/review/jobs/${jobId}/versions`,
    jobSessionEvents: (jobId: string) => `/review/jobs/${jobId}/session-events`,
  },
} as const;
