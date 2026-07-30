import * as FileSystem from "expo-file-system/legacy";

// Turns the pad's capture (`data:image/png;base64,AAAA…`) into a real PNG in the
// app's document directory and returns its file URI — the value that lands in
// audits.signatureUri.
//
// Uses the LEGACY expo-file-system API deliberately. The first cut used SDK 54's
// class API (`new File(...).write(base64, { encoding: "base64" })`) and it threw
// on device in Expo Go — suspected scoped-permission or file-must-exist quirk in
// the new SharedObject layer (this project's third Expo Go quirk; see DECISIONS
// 2026-07-30 reduce-motion, and the header-capsule fix). writeAsStringAsync is
// the years-proven path for exactly this base64→PNG case. Revisit on a dev build.
//
// Deterministic filename per audit: completeAudit's draft-only guard means an
// audit completes at most once, so there is no collision case; a failed-completion
// retry simply overwrites the same file.
//
// Upload to the Supabase storage bucket is NOT this function's job — the flush
// does that via readSignatureBase64 below (STORAGE_WIREIN_PROPOSAL.md); photos
// remain the deferred half of the pattern.
export async function saveSignaturePng(
  auditId: string,
  signatureDataUrl: string
): Promise<string> {
  const base64 = signatureDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const fileUri = `${FileSystem.documentDirectory}signature-${auditId}.png`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fileUri;
}

// The flush's read half: PNG on disk → base64 for the Storage upload. Lives here
// (not in flush.ts) so flush keeps zero native imports — its tests mock THIS
// module (the syncEngine.test precedent) and stay native-free.
export async function readSignatureBase64(fileUri: string): Promise<string> {
  return FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}
