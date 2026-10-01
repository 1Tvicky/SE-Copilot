import { CreateMeetingForm } from "./create-meeting-form";

export default function NewMeetingPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add meeting</h1>
        <p className="text-sm text-muted-foreground">Add a customer meeting to SE Copilot by hand.</p>
      </div>
      <CreateMeetingForm />
    </div>
  );
}
