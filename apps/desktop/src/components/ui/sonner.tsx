import { Toaster as Sonner } from "sonner";

export function Toaster({ theme }: { theme: "dark" | "light" }) {
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      offset={96}
      toastOptions={{
        classNames: {
          toast: "!bg-panel-2 !border-border !text-foreground !rounded-md !font-sans",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}
