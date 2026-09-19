import Link from 'next/link';

import { EXPIRY_DAYS } from '../../schema/mood-vector.ts';
import { listEmissions, mediaUrl } from '../lib/emissions.ts';

// The archive changes once a day, and expiry changes it without a deploy.
export const revalidate = 300;

export default async function ArchivePage() {
  const emissions = await listEmissions();

  return (
    <main>
      <header className="masthead">
        <div>
          <h1>Disposable Feeling</h1>
          <p className="mono">{emissions.length} emissions</p>
        </div>
        <p>
          One track and one poster a day, made from the same reading of the
          world and the same seed. Each is playable for {EXPIRY_DAYS} days and
          then deleted. What survives is the record: the date, the mood, the
          title, and a thumbnail of what you missed.
        </p>
      </header>

      {emissions.length === 0 ? (
        <p className="empty">
          Nothing here yet. Run <code className="mono">npm run daily</code> — or{' '}
          <code className="mono">npm run backfill</code> to fill the archive
          with historical days.
        </p>
      ) : (
        <div className="grid">
          {emissions.map((emission) => {
            const thumb = mediaUrl(emission.thumbnailPath);
            const playable = Boolean(emission.audioPath);
            return (
              <Link
                key={emission.date}
                href={`/${emission.date}`}
                className={playable ? 'card' : 'card expired'}
              >
                <figure>
                  {thumb ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={thumb} alt={emission.title} loading="lazy" />
                  ) : null}
                </figure>
                <h2>{emission.title}</h2>
                <p className="mono">
                  {emission.date}
                  {playable ? '' : ' · expired'}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <footer className="mono">
        Signals: GDELT, CoinGecko, OpenWeatherMap, NOAA space weather, USGS,
        moon phase. GDELT gives you the feeling of the news, not of the world —
        worth saying out loud rather than quietly assuming.
      </footer>
    </main>
  );
}
