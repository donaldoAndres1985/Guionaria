import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVoices } from "@/hooks/useVoice";

/** Voces de Piper en español; las no instaladas se descargan la primera vez que se usan. */
export function VoiceSelect({
  value,
  onChange,
  disabled,
  placeholder = "Elige una voz",
}: {
  value: string | null;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { data: voices = [] } = useVoices();
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full" aria-label="Voz">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {voices.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.label}
            <span className="ml-2 text-[11px] text-muted-foreground">
              {v.installed ? "instalada" : `${v.size_mb} MB`}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
