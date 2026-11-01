"use client";

import { Suspense } from "react";
import styles from "../page.module.css";
import { useWorkspace } from "./use-workspace";
import { WorkspaceSidebar } from "./components/workspace-sidebar";
import { WorkspaceTopbar } from "./components/workspace-topbar";
import { CalendarView } from "./components/calendar-view";
import { EventList } from "./components/event-list";
import { AccountSettings } from "./components/account-settings";
import { SettingsView } from "./components/settings-view";
import { PostDetailModal } from "./components/post-detail-modal";
import { AddEventModal } from "./components/add-event-modal";

function Dashboard() {
  const ws = useWorkspace();

  if (!ws.hydrated) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "#777782",
          background: "#fbfaf8",
        }}
      >
        Cargando espacio…
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <WorkspaceSidebar
        tab={ws.tab}
        setTab={ws.setTab}
        eventsCount={ws.events.length}
        reviewCount={ws.reviewCount}
        profile={ws.profile}
      />

      <section className={styles.main}>
        <WorkspaceTopbar
          tab={ws.tab}
          syncingWorkspace={ws.syncingWorkspace}
          openAddForm={ws.openAddForm}
        />

        <div className={styles.content}>
          {ws.feedback && (
            <p
              role="alert"
              style={{
                color: "#a43a32",
                background: "#fff1f0",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
              }}
            >
              {ws.feedback}
            </p>
          )}

          {ws.tab === "Calendario" && (
            <CalendarView
              persistent={ws.persistent}
              range={ws.range}
              setRange={ws.setRange}
              anchor={ws.anchor}
              setAnchor={ws.setAnchor}
              navigate={ws.navigate}
              dates={ws.dates}
              monthLabel={ws.monthLabel}
              expandedDay={ws.expandedDay}
              setExpandedDay={ws.setExpandedDay}
              firstRevealedPost={ws.firstRevealedPost}
              events={ws.events}
              posts={ws.posts}
              reviewCount={ws.reviewCount}
              openAddForm={ws.openAddForm}
              setTab={ws.setTab}
              onSelectPost={(post) => {
                ws.setSelected(post);
                ws.setEditing(post.text);
                ws.setReconciliationId("");
                ws.setAbsenceConfirmed(false);
              }}
            />
          )}

          {ws.tab === "Eventos" && (
            <EventList
              events={ws.events}
              posts={ws.posts}
              sources={ws.sources}
              accountList={ws.accountList}
              persistent={ws.persistent}
              openAddForm={ws.openAddForm}
              onRetryDrafts={(event) => {
                void ws.retryDrafts(event);
              }}
              onRemoveEvent={(eventId) => {
                void ws.removeEvent(eventId);
              }}
            />
          )}

          {ws.tab === "Cuentas" && (
            <AccountSettings
              accountList={ws.accountList}
              setAccountList={ws.setAccountList}
              posts={ws.posts}
              persistent={ws.persistent}
              onChangeVoice={(account, prompt) => {
                void ws.changeVoice(account, prompt);
              }}
              onChangeBufferChannel={(account, network, channelId) => {
                void ws.changeBufferChannel(account, network, channelId);
              }}
            />
          )}

          {ws.tab === "Ajustes" && (
            <SettingsView
              mode={ws.mode}
              persistent={ws.persistent}
              bufferApiKeyConfigured={ws.bufferApiKeyConfigured}
              sources={ws.sources}
              accountList={ws.accountList}
              onChangeMode={(mode) => {
                void ws.changeMode(mode);
              }}
              onSourcesChange={ws.setSources}
              onSyncComplete={ws.refreshWorkspaceAfterSync}
            />
          )}
        </div>
      </section>

      {ws.selected && (
        <PostDetailModal
          selected={ws.selected}
          onClose={() => ws.setSelected(null)}
          currentEvent={ws.currentEvent}
          editing={ws.editing}
          setEditing={ws.setEditing}
          postValidation={ws.postValidation}
          reconciliationId={ws.reconciliationId}
          setReconciliationId={ws.setReconciliationId}
          absenceConfirmed={ws.absenceConfirmed}
          setAbsenceConfirmed={ws.setAbsenceConfirmed}
          persistent={ws.persistent}
          onSavePostChanges={(post, next) => {
            void ws.savePostChanges(post, next);
          }}
          onRetryPost={(post) => {
            void ws.retryPost(post);
          }}
          onConfirmReconciledPost={(post) => {
            void ws.confirmReconciledPost(post);
          }}
          onConfirmPostAbsent={(post) => {
            void ws.confirmPostAbsent(post);
          }}
        />
      )}

      {ws.showAdd && (
        <AddEventModal
          onClose={ws.closeAddForm}
          sourceUrl={ws.sourceUrl}
          setSourceUrl={ws.setSourceUrl}
          extractingEvent={ws.extractingEvent}
          extractionMessage={ws.extractionMessage}
          setExtractionMessage={ws.setExtractionMessage}
          newEvent={ws.newEvent}
          setNewEvent={ws.setNewEvent}
          isSubstackDraft={ws.isSubstackDraft}
          onExtract={() => {
            void ws.extractEventFromUrl();
          }}
          onAddEvent={() => {
            void ws.addEvent();
          }}
        />
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "#fff" }} />}>
      <Dashboard />
    </Suspense>
  );
}
