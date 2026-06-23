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
    // Step 1 — find the opportunity by solicitation number
    const searchUrl = `${SAM_BASE}/opportunities/v2/search?limit=1&solicitationNumber=${encodeURIComponent(solicitationNumber)}&api_key=${key}`;
    const searchRes = await fetch(searchUrl);
    const searchText = await searchRes.text();

    let searchData: Record<string, unknown>;
    try {
      searchData = JSON.parse(searchText) as Record<string, unknown>;
    } catch {
      res.status(502).json({ error: 'SAM.gov returned non-JSON', detail: searchText.slice(0, 300) });
      return;
    }

    const opportunities = searchData.opportunitiesData as Record<string, unknown>[] | undefined;
    if (!opportunities || opportunities.length === 0) {
      res.status(404).json({ error: 'Opportunity not found', solicitationNumber });
      return;
    }

    const opp = opportunities[0];
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
