import { useEffect, useState } from 'react';
import { extractApiError } from '@/types/api';

/**
 * Hook qui resout une URL signee au mount (et au changement de deps).
 *
 * Usage:
 *   const { url, loading, error } = useSignedUrl(() => getNotePhotoUrlSigned(photo.id), [photo.id]);
 *   return url ? <img src={url} /> : <Spinner />;
 *
 * Le hook re-fetch quand les deps changent. Pas de cache global — chaque
 * appel emet une requete POST /auth/signed-url. Pour cache LRU, voir Phase 2.
 */
export function useSignedUrl(
  builder: () => Promise<string>,
  deps: React.DependencyList = [],
): { url: string | null; loading: boolean; error: string | null } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);

    builder()
      .then((u) => {
        if (!cancelled) {
          setUrl(u);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(extractApiError(err, 'Impossible de generer le lien signe'));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { url, loading, error };
}
