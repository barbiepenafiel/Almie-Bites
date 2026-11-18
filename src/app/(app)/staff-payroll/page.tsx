import { Suspense } from "react";
import { LoadingRows } from "@/components/app/common";
import { PayrollView } from "./payroll-view";

export const metadata = { title: "Staff Earnings & Payments" };

async function WithParams({ searchParams }: { searchParams: PageProps<"/staff-payroll">["searchParams"] }) {
  const sp = await searchParams;
  return <PayrollView initialStaff={typeof sp.staff === "string" ? sp.staff : "all"} />;
}

export default function Page(props: PageProps<"/staff-payroll">) {
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <WithParams searchParams={props.searchParams} />
    </Suspense>
  );
}
