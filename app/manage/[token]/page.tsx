import ManageBooking from "@/components/manage-booking";
import { getBookingConfig } from "@/lib/runtime-config";
import { toBookingUiConfig } from "@/lib/booking-config";

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  return <ManageBooking token={(await params).token} config={toBookingUiConfig(getBookingConfig())} />;
}
