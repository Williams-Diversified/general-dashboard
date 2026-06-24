/**
 * GET /api/sam-docs?solicitationNumber=W912PB26QA077
 *
 * Returns opportunity details and attachment list for a given solicitation number.
 * Keeps SAM_API_KEY server-side — never exposed to the browser or runner prompt.
 */

const SAM_BASE = process.env.SAM_BASE ?? 'https://api.sam.gov';

interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = process.env.SAM_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'SAM_API_KEY not configured' });
    return;
  }

  const solicitationNumber = req.query.solicitationNumber as string | undefined;
  if (!solicitationNumber) {
    res.status(400).json({ error: 'solicitationNumber query param is required' });
    return;
  }

  try {
    // Step 1 — find the opportunity by solicitation number.
    // Try exact solicitationNumber param first; fall back to keyword search (q=)
    // because SAM.gov doesn't reliably index all agencies under solicitationNumber.
    async function searchSam(params: Record<string, string>): Promise<Record<string, unknown>[]> {
      const qs = new URLSearchParams({ limit: '5', api_key: key as string, ...params });
      const res = await fetch(`${SAM_BASE}/opportunities/v2/search?${qs}`);
      const text = await res.text();
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        return (data.opportunitiesData as Record<string, unknown>[]) ?? [];
      } catch {
        return [];
      }
    }

    let opportunities = await searchSam({ solicitationNumber });

    // Fallback 1: keyword search on the full solicitation number
    if (opportunities.length === 0) {
      opportunities = await searchSam({ q: solicitationNumber });
    }

    // Fallback 2: keyword search without trailing suffix (e.g. "FA462626R0014" → "FA462626R")
    if (opportunities.length === 0) {
      const stem = solicitationNumber.replace(/\d{4}$/, '');
      if (stem !== solicitationNumber) {
        opportunities = await searchSam({ q: stem });
      }
    }

    if (opportunities.length === 0) {
      res.status(404).json({ error: 'Opportunity not found', solicitationNumber });
      return;
    }

    // Pick the best match — prefer exact solicitation number match if multiple returned
    const opp =
      opportunities.find(o => (o.solicitationNumber as string)?.toUpperCase() === solicitationNumber.toUpperCase()) ??
      opportunities[0];

    const noticeId = opp.noticeId as string;

    // Step 2 — fetch attachments/resources for this notice
    const resourcesUrl = `${SAM_BASE}/opportunities/v2/opportunities/${noticeId}/resources?api_key=${key}`;
    const resourcesRes = await fetch(resourcesUrl);
    const resourcesText = await resourcesRes.text();

    let resources: unknown[] = [];
    try {
      const resourcesData = JSON.parse(resourcesText) as Record<string, unknown>;
      // SAM.gov returns attachments under either 'attachments' or 'opportunityAttachments'
      const raw = (resourcesData.attachments ?? resourcesData.opportunityAttachments ?? []) as Record<string, unknown>[];
      resources = raw.map(r => ({
        name: r.name ?? r.filename,
        type: r.type ?? r.mimeType,
        fileSize: r.fileSize,
        resourceId: r.resourceId ?? r.attachmentId,
        downloadUrl: `${SAM_BASE}/opportunities/v2/opportunities/${noticeId}/resources/${r.resourceId ?? r.attachmentId}/download?api_key=${key}`,
      }));
    } catch {
      // Resources fetch failed — return opportunity data without attachments
      console.warn('Could not parse SAM.gov resources response:', resourcesText.slice(0, 200));
    }

    const pop = opp.placeOfPerformance as Record<string, unknown> | undefined;
    const location = pop
      ? `${(pop.city as Record<string, unknown>)?.name ?? ''}, ${(pop.state as Record<string, unknown>)?.code ?? ''}`.replace(/^,\s*/, '')
      : undefined;

    res.status(200).json({
      noticeId,
      solicitationNumber: opp.solicitationNumber,
      title: opp.title,
      agency: opp.fullParentPathName ?? opp.organizationHierarchy,
      naicsCode: opp.naicsCode,
      setAside: opp.typeOfSetAsideDescription ?? opp.typeOfSetAside,
      responseDeadLine: opp.responseDeadLine,
      postedDate: opp.postedDate,
      location,
      description: opp.description,
      samUrl: `https://sam.gov/opp/${noticeId}/view`,
      resources,
    });
  } catch (err) {
    console.error('sam-docs error:', err);
    res.status(502).json({
      error: 'Failed to reach SAM.gov',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
