import Link from "next/link";
import { Bot, CalendarClock, ClipboardCheck, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

const FEATURES = [
  {
    icon: CalendarClock,
    title: "Finds your customer meetings",
    description: "Watches the team mailbox or calendar, spots Zoom and Teams meetings, and works out the customer and meeting type.",
  },
  {
    icon: Bot,
    title: "A visible AI notetaker",
    description: "“SE Copilot Notetaker” joins eligible meetings a minute early, announces itself, and waits to be admitted like any guest.",
  },
  {
    icon: FileText,
    title: "Meeting intelligence & MOM",
    description: "Transcript + your notes become requirements, Q&A, decisions, risks, action items and a customer-ready MOM.",
  },
  {
    icon: ClipboardCheck,
    title: "You approve every send",
    description: "Nothing reaches a customer until you have reviewed, edited, approved, and confirmed the email from the Team DL.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between">
          <span className="text-lg font-semibold">SE Copilot</span>
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="container flex flex-col items-center gap-6 py-24 text-center">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            For Solution & Presales Engineers
          </span>
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">Join the meeting. SE Copilot handles the repetitive work.</h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            From the calendar invite to the customer follow-up: capture, understand, and prepare — with the Solution Engineer in control of
            every external communication.
          </p>
          <Button size="lg" asChild>
            <Link href="/sign-in">Sign in with your work account</Link>
          </Button>
        </section>

        <section className="container grid gap-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardHeader>
                <feature.icon className="h-8 w-8 text-primary" />
                <CardTitle className="mt-2 text-base">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        AI prepares. The Solution Engineer decides.
      </footer>
    </div>
  );
}
