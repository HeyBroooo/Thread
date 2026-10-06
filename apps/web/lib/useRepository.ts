'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type JobPayload, type RepositoryPayload } from './api';

export function useRepository(id: string) {
  const [repository, setRepository] = useState<RepositoryPayload | null>(null);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getRepository(id);
      setRepository(data.repository);
      setJob(data.latestJob);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { repository, job, error, loading, refresh };
}
