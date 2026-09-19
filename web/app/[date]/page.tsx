import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EXPIRY_DAYS, MOOD_DIMENSIONS } from '../../../schema/mood-vector.ts';
import {
  formatDuration,
  getEmission,
  listEmissions,
  mediaUrl,
} from '../../lib/emissions.ts';

export const revalidate = 300;

export async function generateStaticParams() {
  const emissions = await listEmissions();
  return emissions.slice(0, 60).map((emission) => ({ date: emission.date }));
}

export default async function EmissionPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const emission = await getEmission(date);
  if (!emission) notFound();

  const poster = mediaUrl(emission.posterPath) ?? mediaUrl(emission.thumbnailPath);
  const audio = mediaUrl(emission.audioPath);
  const expired = !emission.audioPath;
  const num = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);

  return (
    <main>
      <header className="masthead">
        <Link href="/" className="mono">
          ← archive
        </Link>
        <p className="mono">
          {emission.date} · {formatDuration(emission.durationSeconds)} ·{' '}
          {emission.mood.provenance.synthesizer}
        </p>
      </header>

      <article className="emission">
        <div>
          {poster ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={poster} alt={emission.title} />
          ) : null}
        </div>

        <div>
          <h1>{emission.title}</h1>

          {expired ? (
            <p className="notice">
              This one is gone. Audio and poster were deleted {EXPIRY_DAYS} days
              after the emission; what you are looking at is the thumbnail and
              the record. That is the arrangement, not a failure.
            </p>
          ) : audio ? (
            <audio controls preload="none" src={audio} />
          ) : null}

          <ul className="themes">
            {emission.mood.themes.map((theme) => (
              <li key={theme}>{theme}</li>
            ))}
          </ul>

          <dl className="vector mono">
            {MOOD_DIMENSIONS.map((dimension) => (
              <div key={dimension}>
                <dt>{dimension}</dt>
                <dd>{num(emission.mood[dimension])}</dd>
              </div>
            ))}
            <div>
              <dt>seed</dt>
              <dd>{emission.mood.seed}</dd>
            </div>
            <div>
              <dt>baseline</dt>
              <dd>{emission.mood.provenance.baselineDays}d</dd>
            </div>
          </dl>

          <p className="mono" style={{ marginTop: '1.25rem' }}>
            sources: {emission.mood.provenance.sources.join(', ') || 'none'}
            {emission.mood.provenance.missing.length > 0
              ? ` · missing: ${emission.mood.provenance.missing
                  .map((m) => m.source)
                  .join(', ')}`
              : ''}
          </p>
        </div>
      </article>
    </main>
  );
}
