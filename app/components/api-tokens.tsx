import { Alert, Button, Card, Code, CopyButton, Group, Modal, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { API_TOKEN_LIFETIMES } from "../../src/api-token-options.ts";
import { NICKNAME_MAX_LENGTH } from "../../src/limits.ts";
import { useActionFeedback } from "./use-action-feedback.ts";
import { useHeldOpen } from "./use-held-open.ts";

/** An API token as loaders hand it to the page. Never the token itself. */
export interface ApiTokenView {
  id: number;
  name: string;
  /** "lh_…abcd": enough to tell two apart. */
  hint: string;
  created: string;
  lastUsed: string;
  /** null: never expires. */
  expires: string | null;
}

/** What the create action hands back: the token, this once. */
export interface CreatedToken {
  token: string;
  name: string;
}

/**
 * The person's API tokens: what each is for, when it was last used, and a way
 * to revoke it; and a form to make another. A new token is shown once, in a
 * dialog — only its hash is kept.
 */
export function ApiTokens({ tokens, action }: { tokens: ApiTokenView[]; action: string }) {
  const create = useFetcher<{ ok: true; message: string; created?: CreatedToken } | { ok: false; error: string }>();
  useActionFeedback(create.data);
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    const d = create.data;
    if (d?.ok && d.created) {
      setRevealed(d.created);
      setFormKey((k) => k + 1);
    }
  }, [create.data]);

  return (
    <Stack gap="sm">
      {tokens.length === 0 ? (
        <Text size="sm" c="dimmed">
          No tokens.
        </Text>
      ) : (
        tokens.map((t) => <TokenRow key={t.id} token={t} action={action} />)
      )}

      <Card withBorder>
        <create.Form method="post" action={action} key={formKey}>
          <input type="hidden" name="intent" value="create-token" />
          <Group align="end" gap="xs" wrap="wrap">
            <TextInput
              name="name"
              label="New token for"
              placeholder="e.g. Claude daily hours"
              maxLength={NICKNAME_MAX_LENGTH}
              required
              style={{ flex: 1, minWidth: 200 }}
              autoComplete="off"
            />
            <NativeSelect
              name="lifetime"
              label="Lasts"
              data={API_TOKEN_LIFETIMES.map((l) => ({ value: l.key, label: l.label }))}
              defaultValue={API_TOKEN_LIFETIMES[0]!.key}
            />
            <Button type="submit" loading={create.state !== "idle"}>
              Make token
            </Button>
          </Group>
        </create.Form>
      </Card>

      <TokenReveal revealed={revealed} onClose={() => setRevealed(null)} />
    </Stack>
  );
}

function TokenRow({ token, action }: { token: ApiTokenView; action: string }) {
  const fetcher = useFetcher();
  useActionFeedback(fetcher.data);
  const [confirming, setConfirming] = useState(false);
  return (
    <Card withBorder padding="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap" align="start">
          <Stack gap={2}>
            <Group gap="xs">
              <Text fw={500}>{token.name}</Text>
              <Text size="sm" c="dimmed" ff="monospace">
                {token.hint}
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              Made {token.created} · last used {token.lastUsed} ·{" "}
              {token.expires ? `expires ${token.expires}` : "never expires"}
            </Text>
          </Stack>
          {!confirming && (
            <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          )}
        </Group>
        {confirming && (
          <fetcher.Form method="post" action={action}>
            <input type="hidden" name="intent" value="revoke-token" />
            <input type="hidden" name="tokenId" value={token.id} />
            <Stack gap="xs">
              <Text size="sm">Revoke “{token.name}”? Whatever uses it stops working at once.</Text>
              <Group gap="xs">
                <Button type="submit" size="xs" color="red" loading={fetcher.state !== "idle"}>
                  Revoke token
                </Button>
                <Button size="xs" variant="subtle" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
              </Group>
            </Stack>
          </fetcher.Form>
        )}
      </Stack>
    </Card>
  );
}

function TokenReveal({
  revealed,
  onClose,
}: {
  revealed: { token: string; name: string } | null;
  onClose: () => void;
}) {
  const narrow = useMediaQuery("(max-width: 36em)");
  // Closing clears the token; the dialog would otherwise fade out empty.
  const shown = useHeldOpen(revealed != null, revealed);
  return (
    <Modal opened={revealed != null} onClose={onClose} title="New token" centered size="md" fullScreen={narrow}>
      {shown && (
        <Stack gap="md">
          <Text fw={500}>{shown.name}</Text>
          <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {shown.token}
          </Code>
          <CopyButton value={shown.token}>
            {({ copied, copy }) => (
              <Button variant={copied ? "filled" : "light"} color={copied ? "green" : undefined} onClick={copy}>
                {copied ? "Copied" : "Copy token"}
              </Button>
            )}
          </CopyButton>
          <Alert color="blue">
            This is the only time it's shown. Put it where the script reads it, and keep it out of chats, email and
            git. If it's lost or seen by anyone else, revoke it and make a new one.
          </Alert>
          <Button onClick={onClose}>Done</Button>
        </Stack>
      )}
    </Modal>
  );
}
