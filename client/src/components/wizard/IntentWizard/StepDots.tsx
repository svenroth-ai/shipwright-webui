/*
 * StepDots — the shared step indicator (A08). One component, three doors:
 * `total` is 5 for the new door (4 questions + plan) and 3 for adopt/grade
 * (pick → working → result). `current` is 0-indexed.
 */

interface StepDotsProps {
  total: number;
  current: number;
}

export function StepDots({ total, current }: StepDotsProps) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const cls = i < current ? "sd done" : i === current ? "sd active" : "sd";
    dots.push(<div key={`d${i}`} className={cls} />);
    if (i < total - 1) {
      dots.push(<div key={`c${i}`} className={i < current ? "sc done" : "sc"} />);
    }
  }
  return (
    <div className="stepdots" data-testid="wizard-stepdots" aria-hidden="true">
      {dots}
    </div>
  );
}
