import { Progress } from "@/components/ui/progress";

export function ProgressBar({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress));
  return <Progress value={clamped} className="h-2" />;
}
