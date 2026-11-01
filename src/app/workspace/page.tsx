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
import { WorkspaceErrorBoundary } from "./components/workspace-error-boundary";

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
            <WorkspaceErrorBoundary fallbackTitle="Error al cargar el calendario">
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
                  ws.setDraftDeleteError("");
                }}
              />
            </WorkspaceErrorBoundary>
          )}

          {ws.tab === "Eventos" && (
            <WorkspaceErrorBoundary fallbackTitle="Error al cargar la lista de eventos">
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
            </WorkspaceErrorBoundary>
          )}

          {ws.tab === "Cuentas" && (
            <WorkspaceErrorBoundary fallbackTitle="Error al cargar la configuración de cuentas">
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
            </WorkspaceErrorBoundary>
          )}

          {ws.tab === "Ajustes" && (
            <WorkspaceErrorBoundary fallbackTitle="Error al cargar los ajustes">
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
            </WorkspaceErrorBoundary>
          )}
        </div>
      </section>

      {ws.selected && (
        <PostDetailModal
          selected={ws.selected}
          deletingDraft={ws.deletingDraft}
          draftDeleteError={ws.draftDeleteError}
          onRemoveDraft={(post) => { void ws.removeDraft(post); }}
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
          accounts={ws.accountList}
          selectedAccountIds={ws.selectedAccountIds}
          setSelectedAccountIds={ws.setSelectedAccountIds}
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
