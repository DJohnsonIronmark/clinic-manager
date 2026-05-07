'use client';

import { useState } from 'react';

interface EmbeddingStatus {
  table: string;
  total_records: number;
  with_embeddings: number;
  coverage_percentage: number;
  pending_in_queue: number;
}

interface SemanticSearchResult {
  id: string;
  similarity: number;
  [key: string]: unknown;
}

const SparklesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);

const DatabaseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0115-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 01-15 6.7L3 16" />
  </svg>
);

interface AIInsightsPanelProps {
  supabaseUrl: string;
  supabaseKey: string;
}

export default function AIInsightsPanel({ supabaseUrl, supabaseKey }: AIInsightsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'status'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTable, setSearchTable] = useState('clinic_leads');
  const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus[]>([]);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tables = [
    { value: 'clinic_leads', label: 'Clinic Leads' },
    { value: 'aio_visibility_results', label: 'AI Visibility Results' },
    { value: 'tiktok_daily_ads', label: 'TikTok Ads' },
  ];

  const handleSemanticSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError(null);
    setSearchResults([]);

    try {
      // First generate embedding for the query
      const embedResponse = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: searchQuery }),
      });

      if (!embedResponse.ok) {
        throw new Error('Failed to generate embedding. Make sure OpenAI API key is configured.');
      }

      const embedData = await embedResponse.json();
      const embedding = embedData.embeddings;

      // Then search using the appropriate RPC function
      let rpcFunction = '';
      switch (searchTable) {
        case 'clinic_leads':
          rpcFunction = 'find_similar_leads';
          break;
        case 'aio_visibility_results':
          rpcFunction = 'search_visibility_results';
          break;
        case 'tiktok_daily_ads':
          rpcFunction = 'find_similar_ads';
          break;
      }

      const searchResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcFunction}`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query_embedding: JSON.stringify(embedding),
          match_count: 10,
          similarity_threshold: 0.5,
        }),
      });

      if (!searchResponse.ok) {
        const errorText = await searchResponse.text();
        throw new Error(`Search failed: ${errorText}`);
      }

      const results = await searchResponse.json();
      setSearchResults(results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const loadEmbeddingStatus = async () => {
    setIsLoadingStatus(true);
    setError(null);

    try {
      const statuses: EmbeddingStatus[] = [];

      for (const table of tables) {
        // Get total count
        const totalResponse = await fetch(
          `${supabaseUrl}/rest/v1/${table.value}?select=id&limit=1`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Prefer': 'count=exact',
            },
          }
        );
        const totalCount = parseInt(totalResponse.headers.get('content-range')?.split('/')[1] || '0');

        // Get count with embeddings
        const withEmbeddingResponse = await fetch(
          `${supabaseUrl}/rest/v1/${table.value}?select=id&embedding=not.is.null&limit=1`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Prefer': 'count=exact',
            },
          }
        );
        const withEmbeddingCount = parseInt(
          withEmbeddingResponse.headers.get('content-range')?.split('/')[1] || '0'
        );

        // Get pending queue count
        const queueResponse = await fetch(
          `${supabaseUrl}/rest/v1/embedding_queue?select=id&table_name=eq.${table.value}&status=eq.pending&limit=1`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Prefer': 'count=exact',
            },
          }
        );
        const pendingCount = parseInt(
          queueResponse.headers.get('content-range')?.split('/')[1] || '0'
        );

        statuses.push({
          table: table.label,
          total_records: totalCount,
          with_embeddings: withEmbeddingCount,
          coverage_percentage: totalCount > 0 ? Math.round((withEmbeddingCount / totalCount) * 100) : 0,
          pending_in_queue: pendingCount,
        });
      }

      setEmbeddingStatus(statuses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const triggerBackfill = async (tableName: string) => {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/backfill-embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table_name: tableName,
          batch_size: 100,
        }),
      });

      if (!response.ok) {
        throw new Error('Backfill failed');
      }

      const result = await response.json();
      alert(`Queued ${result.queued} records for embedding generation.`);
      loadEmbeddingStatus();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger backfill');
    }
  };

  return (
    <div className="border-t border-gray-200 mt-4 pt-4">
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
          if (!isExpanded && embeddingStatus.length === 0) {
            loadEmbeddingStatus();
          }
        }}
        className="w-full flex items-center justify-between px-3 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-lg hover:from-purple-600 hover:to-indigo-600 transition"
      >
        <div className="flex items-center gap-2">
          <SparklesIcon />
          <span className="font-medium">AI Features</span>
        </div>
        <svg
          className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* Tab Navigation */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('search')}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm rounded-md transition ${
                activeTab === 'search'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <SearchIcon />
              Semantic Search
            </button>
            <button
              onClick={() => {
                setActiveTab('status');
                if (embeddingStatus.length === 0) loadEmbeddingStatus();
              }}
              className={`flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm rounded-md transition ${
                activeTab === 'status'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <DatabaseIcon />
              Status
            </button>
          </div>

          {/* Search Tab */}
          {activeTab === 'search' && (
            <div className="space-y-3">
              <select
                value={searchTable}
                onChange={(e) => setSearchTable(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {tables.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearch()}
                  placeholder="Describe what you're looking for..."
                  className="flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  onClick={handleSemanticSearch}
                  disabled={isSearching || !searchQuery.trim()}
                  className="px-4 py-2 bg-purple-500 text-white text-sm rounded-lg hover:bg-purple-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {isSearching ? '...' : 'Search'}
                </button>
              </div>

              {error && (
                <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {error}
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="max-h-60 overflow-y-auto space-y-2">
                  <p className="text-xs text-gray-500 font-medium">
                    Found {searchResults.length} similar records
                  </p>
                  {searchResults.map((result, idx) => (
                    <div
                      key={result.id || idx}
                      className="p-2 bg-gray-50 rounded-lg text-sm"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          {searchTable === 'clinic_leads' && (
                            <>
                              <p className="font-medium text-gray-800 truncate">
                                {(result.first_name as string) || ''} {(result.last_name as string) || 'Unknown'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {(result.city as string) || ''}, {(result.state as string) || ''} • {(result.lead_source as string) || 'N/A'}
                              </p>
                            </>
                          )}
                          {searchTable === 'aio_visibility_results' && (
                            <>
                              <p className="font-medium text-gray-800 truncate">
                                {(result.prompt_category as string) || 'Query'}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {(result.prompt_text as string)?.substring(0, 50) || ''}...
                              </p>
                            </>
                          )}
                          {searchTable === 'tiktok_daily_ads' && (
                            <>
                              <p className="font-medium text-gray-800 truncate">
                                {(result.ad_name as string) || 'Ad'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {(result.campaign_name as string)?.substring(0, 30) || ''}
                              </p>
                            </>
                          )}
                        </div>
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                          {((result.similarity as number) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Status Tab */}
          {activeTab === 'status' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600 font-medium">Embedding Coverage</p>
                <button
                  onClick={loadEmbeddingStatus}
                  disabled={isLoadingStatus}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                >
                  <RefreshIcon />
                </button>
              </div>

              {isLoadingStatus ? (
                <div className="text-center py-4 text-sm text-gray-500">Loading...</div>
              ) : (
                <div className="space-y-2">
                  {embeddingStatus.map((status) => (
                    <div key={status.table} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium text-gray-700">{status.table}</span>
                        <span className="text-xs text-gray-500">
                          {status.with_embeddings.toLocaleString()} / {status.total_records.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            status.coverage_percentage >= 90
                              ? 'bg-green-500'
                              : status.coverage_percentage >= 50
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${status.coverage_percentage}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">
                          {status.coverage_percentage}% covered
                          {status.pending_in_queue > 0 && (
                            <span className="ml-2 text-yellow-600">
                              ({status.pending_in_queue} pending)
                            </span>
                          )}
                        </span>
                        {status.coverage_percentage < 100 && (
                          <button
                            onClick={() => {
                              const tableValue = tables.find(t => t.label === status.table)?.value;
                              if (tableValue) triggerBackfill(tableValue);
                            }}
                            className="text-xs text-purple-600 hover:text-purple-800"
                          >
                            Queue backfill
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
