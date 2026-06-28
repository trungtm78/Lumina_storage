const fileTypes = ["pdf", "image", "doc", "xls", "txt"];

const documentTypes = [
  "Invoice",
  "Contract",
  "Receipt",
  "Report",
  "Letter",
  "Presentation",
  "Spreadsheet",
  "Form",
  "Certificate",
  "Manual",
];

const correspondents = [
  "Acme Corporation",
  "Global Solutions Inc",
  "Tech Innovations Ltd",
  "Finance Partners",
  "Legal Associates",
  "Marketing Agency",
  "Consulting Group",
  "Supply Chain Co",
  "Manufacturing LLC",
  "Retail Partners",
  "Service Providers",
  "Distribution Network",
];

const tags = [
  "Important",
  "Urgent",
  "Archive",
  "Review",
  "Approved",
  "Pending",
  "Financial",
  "Legal",
  "HR",
  "Marketing",
  "Sales",
  "Operations",
  "IT",
  "Compliance",
  "Tax",
  "Audit",
];

const storagePaths = [
  "/Archive/2026",
  "/Archive/2025",
  "/Archive/2024",
  "/Inbox",
  "/Documents/Financial",
  "/Documents/Legal",
  "/Documents/HR",
  "/Documents/Projects",
];

const documentTitles = [
  "Annual Financial Report",
  "Q1 Performance Review",
  "Marketing Strategy Document",
  "Employee Handbook",
  "Tax Documentation",
  "Project Proposal",
  "Meeting Minutes",
  "Contract Agreement",
  "Budget Analysis",
  "Sales Forecast",
  "Compliance Report",
  "Vendor Agreement",
  "Training Materials",
  "Policy Updates",
  "Business Plan",
];

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomElements<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function getRandomDate(start: Date, end: Date): Date {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime())
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function generateMockDocuments(count: number): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const documents: any[] = [];
  const startDate = new Date(2020, 0, 1);
  const endDate = new Date(2026, 2, 18);

  for (let i = 0; i < count; i++) {
    const fileType = getRandomElement(fileTypes);
    const tagCount = Math.floor(Math.random() * 4) + 1;

    documents.push({
      id: `doc-${i + 1}`,
      title: `${getRandomElement(documentTitles)} ${i + 1}`,
      createdDate: getRandomDate(startDate, endDate),
      tags: getRandomElements(tags, tagCount),
      correspondent: getRandomElement(correspondents),
      documentType: getRandomElement(documentTypes),
      storagePath: getRandomElement(storagePaths),
      fileType,
      pageCount:
        fileType === "pdf" ? Math.floor(Math.random() * 50) + 1 : undefined,
      fileSize: formatFileSize(Math.floor(Math.random() * 10000000) + 10000),
    });
  }

  return documents.sort(
    (a, b) => b.createdDate.getTime() - a.createdDate.getTime()
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllTags(documents: any[]): string[] {
  const tagSet = new Set<string>();
  documents.forEach((doc: { tags?: string[] }) =>
    doc.tags?.forEach((tag: string) => tagSet.add(tag))
  );
  return Array.from(tagSet).sort();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllCorrespondents(documents: any[]): string[] {
  const correspondentSet = new Set<string>();
  documents.forEach((doc: { correspondent?: string }) => {
    if (doc.correspondent) correspondentSet.add(doc.correspondent);
  });
  return Array.from(correspondentSet).sort();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllDocumentTypes(documents: any[]): string[] {
  const typeSet = new Set<string>();
  documents.forEach((doc: { documentType?: string }) => {
    if (doc.documentType) typeSet.add(doc.documentType);
  });
  return Array.from(typeSet).sort();
}
