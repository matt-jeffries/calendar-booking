import BookingPage, { isEmbedded, ratesAreVisible, type BookingSearchParams } from "@/app/booking-page";

export const dynamic = "force-dynamic";

export default async function SixtyMinuteBooking({ searchParams }: { searchParams: BookingSearchParams }) {
  const { rates, embed } = await searchParams;
  return <BookingPage fixedDuration={60} showRates={ratesAreVisible(rates)} embedded={isEmbedded(embed)} />;
}
