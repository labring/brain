import { redirect } from "next/navigation";
import {
  appendMarketingRedirectQuery,
  type MarketingRedirectQuery,
} from "@/features/marketing/redirect-query";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<MarketingRedirectQuery>;
}) {
  redirect(appendMarketingRedirectQuery("/project", await searchParams));
}
