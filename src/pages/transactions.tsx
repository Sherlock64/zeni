import { ReceiptTextIcon } from "lucide-react";
import { Page } from "@/components/page";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export function TransactionsPage() {
  return (
    <Page title="Transactions" description="Every payment in and out of your accounts.">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptTextIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2>No transactions yet</h2>
          </EmptyTitle>
          <EmptyDescription>Importing bank files arrives in a later version of Zeni. Your transactions will show up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Page>
  );
}
