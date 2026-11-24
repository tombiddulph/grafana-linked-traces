export function seed(options?: { chain?: boolean }): Promise<{
  producer: string;
  worker: string;
  downstream: Array<{ service: string; id: string }>;
}>;
