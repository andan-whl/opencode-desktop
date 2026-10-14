// @ts-nocheck
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { onMount } from "solid-js"
import { DialogSelectModelUnpaid } from "./unpaid"

function SelectModelWithoutProviders() {
  const dialog = useDialog()

  const open = () => dialog.show(() => <DialogSelectModelUnpaid />)

  onMount(open)

  return (
    <Button variant="neutral" onClick={open}>
      Open select model dialog
    </Button>
  )
}

export default {
  title: "App/Dialogs/Select Model",
  id: "app-dialog-select-model",
}

export const WithoutProviders = {
  render: () => <SelectModelWithoutProviders />,
}
