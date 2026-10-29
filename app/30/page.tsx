import BookingPage, { isEmbedded, ratesAreVisible, type BookingSearchParams } from "@/app/booking-page";

export const dynamic = "force-dynamic";

export default async function ThirtyMinuteBooking({ searchParams }: { searchParams: BookingSearchParams }) {
  const { rates, embed } = await searchParams;
  return <BookingPage fixedDuration={30} showRates={ratesAreVisible(rates)} embedded={isEmbedded(embed)} />;
}
