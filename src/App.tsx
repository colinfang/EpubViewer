import { DropzoneLanding } from "./components/DropzoneLanding";
import { ReaderShell } from "./components/ReaderShell";
import { useReaderController } from "./hooks/useReaderController";

export function App() {
	const {
		readerState,
		relocation,
		settings,
		updateSettings,
		chromeVisible,
		tocOpen,
		setTocOpen,
		openFile,
		closeBook,
		mountViewport,
	} = useReaderController();

	if (readerState.status === "ready") {
		return (
			<ReaderShell
				manifest={readerState.manifest}
				engine={readerState.engine}
				relocation={relocation}
				settings={settings}
				onUpdateSettings={updateSettings}
				chromeVisible={chromeVisible}
				tocOpen={tocOpen}
				onSetTocOpen={setTocOpen}
				onCloseBook={closeBook}
				mountViewport={mountViewport}
			/>
		);
	}

	return (
		<div data-reader-theme={settings.theme} className="h-full w-full">
			<DropzoneLanding
				onSelectFile={(file) => void openFile(file)}
				errorMessage={
					readerState.status === "error" ? readerState.message : null
				}
				isLoading={readerState.status === "loading"}
				loadingFileName={
					readerState.status === "loading" ? readerState.fileName : null
				}
			/>
		</div>
	);
}
