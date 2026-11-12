import { useEffect, useState } from "react";
import { type Editor } from "@tiptap/react";

/** Re-render on every editor transaction so button active/enabled state tracks
 *  the live selection regardless of the parent's render cadence. */
export function useEditorTick(editor: Editor | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => setTick((n) => n + 1);
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);
}
