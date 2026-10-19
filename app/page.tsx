import BookingPage, { ratesAreVisible, type BookingSearchParams } from "@/app/booking-page";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: BookingSearchParams }) {
  const { rates } = await searchParams;
  return <BookingPage showRates={ratesAreVisible(rates)} />;
}
