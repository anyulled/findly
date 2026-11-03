import Image from "next/image";
import styles from "../../page.module.css";
import type { Account, Network, Post } from "../workspace-types";
import { matchesAccount } from "../workspace-types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NetworkIcon } from "@/components/ui/network-icon";
import { Database, Sparkles } from "lucide-react";

interface AccountSettingsProps {
  accountList: Account[];
  setAccountList: React.Dispatch<React.SetStateAction<Account[]>>;
  posts: Post[];
  persistent: boolean;
  onChangeVoice: (account: Account, prompt: string) => void;
  onChangeBufferChannel: (account: Account, network: Network, channelId: string) => void;
}

export function AccountSettings({
  accountList,
  setAccountList,
  posts,
  persistent,
  onChangeVoice,
  onChangeBufferChannel,
}: AccountSettingsProps) {
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <div className={styles.eyebrow}>CANALES Y VOZ DE MARCA</div>
          <h1>Tus cuentas</h1>
          <p>Cada cuenta tiene una voz propia para tus publicaciones.</p>
        </div>
      </div>
      <div className={styles.accountsGrid}>
        {accountList.map((account) => (
          <Card className={styles.accountCard} key={account.id ?? account.name}>
            <div className={styles.accountTop}>
              <Image
                className={styles.accountLogo}
                src={account.logo}
                alt={`Logo de ${account.name}`}
                width={38}
                height={38}
              />
              <div>
                <b>{account.name}</b>
                <small>{account.kind}</small>
              </div>
              <Badge variant={persistent ? "success" : "secondary"} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Database size={11} aria-hidden="true" />
                {persistent ? "Supabase" : "Demo"}
              </Badge>
            </div>
            <div style={{ marginTop: "10px", marginBottom: "8px" }}>
              <Badge variant={account.bufferApiKeyConfigured ? "outline" : "warning"}>
                {account.bufferApiKeyConfigured
                  ? "API key configurada"
                  : `Falta ${account.bufferApiKeyEnv}`}
              </Badge>
            </div>
            <div className={styles.accountNetworks}>
              {account.networks.map((network) => (
                <Badge variant="outline" key={network} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <NetworkIcon network={network} size={13} />
                  {network}
                </Badge>
              ))}
            </div>
            <div className={styles.bufferChannels}>
              <h4>CANALES DE BUFFER</h4>
              <p>Introduce el ID del canal de Buffer conectado a cada red.</p>
              {account.networks.map((network) => (
                <label key={network}>
                  <span>{network}</span>
                  <input
                    aria-label={`ID de canal de Buffer ${network} para ${account.name}`}
                    value={account.bufferChannels?.[network] ?? ""}
                    disabled={!persistent}
                    onChange={(event) =>
                      setAccountList((all) =>
                        all.map((item) =>
                          matchesAccount(item, account)
                            ? {
                                ...item,
                                bufferChannels: {
                                  ...item.bufferChannels,
                                  [network]: event.target.value,
                                },
                              }
                            : item,
                        ),
                      )
                    }
                    onBlur={(event) => {
                      onChangeBufferChannel(account, network, event.currentTarget.value);
                    }}
                    placeholder="ID del canal"
                  />
                </label>
              ))}
            </div>
            <label>
              VOZ Y TONO
              <textarea
                value={account.prompt}
                onChange={(e) =>
                  setAccountList((all) =>
                    all.map((item) =>
                      matchesAccount(item, account) ? { ...item, prompt: e.target.value } : item,
                    ),
                  )
                }
                onBlur={(e) => {
                  onChangeVoice(account, e.currentTarget.value);
                }}
                rows={3}
              />
            </label>
            <div className={styles.exampleBox}>
              <Sparkles size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <b>
                  {account.styleExampleCount ??
                    posts.filter((p) => p.account === account.name && p.status === "approved").length}{" "}
                  ejemplos aprobados
                </b>
                <small>Las publicaciones aprobadas ayudan a mantener tu estilo.</small>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
