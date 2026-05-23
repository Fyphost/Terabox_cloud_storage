export default function PlayerSkeleton() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-surface">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-surface via-bg to-surface" />
    </div>
  );
}
