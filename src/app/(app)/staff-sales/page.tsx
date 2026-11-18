import { Suspense } from "react";
import { LoadingRows } from "@/components/app/common";
import { StaffSalesView } from "./staff-sales-view";

export const metadata = { title: "Staff Sales" };

async function WithParams({ searchParams }: { searchParams: PageProps<"/staff-sales">["searchParams"] }) {
  const sp = await searchParams;
  return <StaffSalesView initialStaff={typeof sp.staff === "string" ? sp.staff : "all"} />;
}

export default function Page(props: PageProps<"/staff-sales">) {
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <WithParams searchParams={props.searchParams} />
    </Suspense>
  );
}
