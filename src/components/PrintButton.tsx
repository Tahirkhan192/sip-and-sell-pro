import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";

/** Print / Save-as-PDF for any report page. Uses the browser print dialog
 *  (choose "Save as PDF" to download). Existing calculations are untouched. */
export function PrintButton({ title, className }: { title?: string; className?: string }) {
  function print() {
    const prev = document.title;
    if (title) document.title = title;
    window.print();
    setTimeout(() => { document.title = prev; }, 500);
  }
  return (
    <div className={`no-print flex gap-2 ${className ?? ""}`}>
      <Button size="sm" variant="outline" onClick={print}>
        <Printer className="h-4 w-4 mr-1" /> Print
      </Button>
      <Button size="sm" variant="outline" onClick={print}>
        <Download className="h-4 w-4 mr-1" /> PDF
      </Button>
    </div>
  );
}
