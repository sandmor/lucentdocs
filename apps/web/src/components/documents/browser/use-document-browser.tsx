import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { toast } from 'sonner'
import {
  directoryPathFromSentinel,
  isDirectorySentinelPath,
  isPathInsideDirectory,
  type IndexingStrategy,
  normalizeDocumentPath,
  pathSegments,
} from '@lucentdocs/shared'
import { trpc } from '@/lib/trpc'
import { parseDropData } from './dnd-utils'
import {
  basename,
  buildRows,
  normalizeDestination,
  parentPath,
  remapPathInsideDirectory,
} from './path-utils'
import type { SortField, SortDirection } from './list-toolbar'
import type {
  BrowserRow,
  DeleteTarget,
  DocumentSearchResultItem,
  DocumentBrowserProps,
  DocumentItem,
  MarkdownRawHtmlMode,
  DragData,
  DropData,
  MoveTarget,
  RenameTarget,
} from './types'

type ImportLimits = {
  docImportChars: number
  docImportBatchDocs: number
  transferMaxBytes: number
}

function estimatePayloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

export function useDocumentBrowser({
  projectId,
  documents,
  isLoading,
  activeDocumentId,
  onOpenDocument,
}: DocumentBrowserProps) {
  const [userPath, setUserPath] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<'filter' | 'semantic'>('semantic')
  const [searchScope, setSearchScope] = useState<'folder' | 'subtree' | 'project'>('subtree')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [newDocumentName, setNewDocumentName] = useState('')
  const [newDirectoryName, setNewDirectoryName] = useState('')
  const [createDocumentOpen, setCreateDocumentOpen] = useState(false)
  const [createDirectoryOpen, setCreateDirectoryOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameName, setRenameName] = useState('')
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [moveDestination, setMoveDestination] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [settingsDocumentId, setSettingsDocumentId] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importDraft, setImportDraft] = useState<{ fileName: string; markdown: string } | null>(
    null
  )
  const [importSplitMode, setImportSplitMode] = useState<'heading' | 'size'>('heading')
  const [importHeadingLevel, setImportHeadingLevel] = useState<1 | 2 | 3>(1)
  const [importTargetChars, setImportTargetChars] = useState<number>(150_000)
  const [importRawHtmlMode, setImportRawHtmlMode] = useState<MarkdownRawHtmlMode>('code_block')
  const [importIncludeContents, setImportIncludeContents] = useState(true)
  const [importProgress, setImportProgress] = useState<{
    total: number
    imported: number
    failed: number
    isRunning: boolean
  }>({ total: 0, imported: 0, failed: 0, isRunning: false })

  useEffect(() => {
    if (searchMode === 'semantic') {
      const timer = setTimeout(() => {
        setDebouncedSearchQuery(searchQuery.trim())
      }, 300)
      return () => clearTimeout(timer)
    }
    setDebouncedSearchQuery('')
  }, [searchQuery, searchMode])

  const isSemanticSearchActive = searchMode === 'semantic' && debouncedSearchQuery.length > 0
  const isFilterActive = searchMode === 'filter' && searchQuery.trim().length > 0
  const isSearchActive = isSemanticSearchActive || isFilterActive

  const utils = trpc.useUtils()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const loadImportLimits = useCallback(async (): Promise<ImportLimits> => {
    const limits = await utils.documents.importLimits.fetch()
    if (!limits) {
      throw new Error('Server did not return import limits.')
    }
    return limits
  }, [utils.documents.importLimits])

  const { setNodeRef: setRootDropRef, isOver: isOverRoot } = useDroppable({
    id: 'drop:root',
    data: { kind: 'root' } satisfies DropData,
  })

  const allDocuments = documents
  const visibleDocuments = useMemo(
    () => allDocuments.filter((doc) => !isDirectorySentinelPath(normalizeDocumentPath(doc.title))),
    [allDocuments]
  )
  const normalizedDocumentPaths = useMemo(
    () => visibleDocuments.map((doc) => normalizeDocumentPath(doc.title)),
    [visibleDocuments]
  )
  const documentPathSet = useMemo(() => new Set(normalizedDocumentPaths), [normalizedDocumentPaths])

  const explicitDirectoryPaths = useMemo(
    () =>
      allDocuments
        .map((doc) => directoryPathFromSentinel(normalizeDocumentPath(doc.title)))
        .flatMap((value) => (value ? [value] : [])),
    [allDocuments]
  )
  const explicitDirectoryPathSet = useMemo(
    () => new Set(explicitDirectoryPaths),
    [explicitDirectoryPaths]
  )

  const activeDocumentPath = useMemo(() => {
    const active = visibleDocuments.find((doc) => doc.id === activeDocumentId)
    return active ? normalizeDocumentPath(active.title) : null
  }, [visibleDocuments, activeDocumentId])

  const currentPath = userPath ?? (activeDocumentPath ? parentPath(activeDocumentPath) : '')

  const searchResultsQuery = trpc.documents.search.useQuery(
    {
      projectId,
      query: debouncedSearchQuery,
      scope:
        searchScope === 'project'
          ? { type: 'project' as const }
          : searchScope === 'folder' && typeof currentPath === 'string'
            ? { type: 'directory' as const, directoryPath: currentPath }
            : searchScope === 'subtree' && typeof currentPath === 'string'
              ? { type: 'directory_subtree' as const, directoryPath: currentPath }
              : { type: 'project' as const },
    },
    {
      enabled: isSemanticSearchActive,
    }
  )

  const searchRows = useMemo<Array<BrowserRow>>(() => {
    const results = (searchResultsQuery.data ?? []).map((result: DocumentSearchResultItem) => ({
      key: `search:${result.id}`,
      type: 'search-result' as const,
      id: result.id,
      name: basename(normalizeDocumentPath(result.title)),
      path: normalizeDocumentPath(result.title),
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      score: result.score,
      matchType: result.matchType,
      snippets: result.snippets,
    }))

    return results
  }, [searchResultsQuery.data])

  // Client-side title filtering
  const filterRows = useMemo<Array<BrowserRow>>(() => {
    if (!isFilterActive) return []
    const query = searchQuery.trim().toLowerCase()

    let sourceRows: BrowserRow[]
    if (searchScope === 'folder') {
      sourceRows = buildRows(allDocuments, currentPath)
    } else if (searchScope === 'subtree') {
      const prefix = currentPath ? `${currentPath}/` : ''
      sourceRows = visibleDocuments
        .filter((doc) => {
          const normalizedPath = normalizeDocumentPath(doc.title)
          return !prefix || normalizedPath.startsWith(prefix)
        })
        .map((doc) => {
          const normalizedPath = normalizeDocumentPath(doc.title)
          return {
            key: `doc:${doc.id}`,
            type: 'document' as const,
            id: doc.id,
            name: basename(normalizedPath),
            path: normalizedPath,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
          }
        })
    } else {
      sourceRows = visibleDocuments.map((doc) => {
        const normalizedPath = normalizeDocumentPath(doc.title)
        return {
          key: `doc:${doc.id}`,
          type: 'document' as const,
          id: doc.id,
          name: basename(normalizedPath),
          path: normalizedPath,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }
      })
    }

    return sourceRows.filter((row) => {
      if (row.type === 'search-result') return false
      return row.name.toLowerCase().includes(query) || row.path.toLowerCase().includes(query)
    })
  }, [allDocuments, currentPath, isFilterActive, searchQuery, searchScope, visibleDocuments])

  const sortRows = useCallback(
    (input: BrowserRow[]): BrowserRow[] => {
      const dirFirst = (a: BrowserRow, b: BrowserRow) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return 0
      }

      const fieldComparator = (a: BrowserRow, b: BrowserRow) => {
        if (sortField === 'name') {
          return sortDirection === 'asc'
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name)
        }
        const aVal = a[sortField]
        const bVal = b[sortField]
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
      }

      return [...input].sort((a, b) => dirFirst(a, b) || fieldComparator(a, b))
    },
    [sortField, sortDirection]
  )

  const rows = useMemo(() => {
    if (isSemanticSearchActive) return searchRows
    if (isFilterActive) return sortRows(filterRows)
    return sortRows(buildRows(allDocuments, currentPath))
  }, [
    allDocuments,
    currentPath,
    filterRows,
    isFilterActive,
    isSemanticSearchActive,
    searchRows,
    sortRows,
  ])

  const breadcrumbs = useMemo(() => pathSegments(currentPath), [currentPath])

  const invalidateBrowserQueries = useCallback(() => {
    utils.documents.list.invalidate({ projectId })
    utils.documents.search.invalidate()
  }, [projectId, utils.documents.list, utils.documents.search])

  const isDirectoryPathTaken = useCallback(
    (path: string): boolean => {
      if (explicitDirectoryPathSet.has(path)) return true
      if (normalizedDocumentPaths.some((value) => value.startsWith(`${path}/`))) return true
      if (explicitDirectoryPaths.some((value) => value.startsWith(`${path}/`))) return true
      return false
    },
    [explicitDirectoryPathSet, explicitDirectoryPaths, normalizedDocumentPaths]
  )

  const findDocumentById = useCallback(
    (documentId: string): DocumentItem | undefined =>
      visibleDocuments.find((document) => document.id === documentId),
    [visibleDocuments]
  )

  const createMutation = trpc.documents.create.useMutation({
    onSuccess: (doc) => {
      setCreateDocumentOpen(false)
      setNewDocumentName('')
      invalidateBrowserQueries()
      utils.documents.get.invalidate({ projectId, id: doc.id })
      onOpenDocument(doc.id)
    },
    onError: (error) => {
      toast.error('Failed to create document', { description: error.message })
    },
  })

  const createDirectoryMutation = trpc.documents.createDirectory.useMutation({
    onSuccess: (_result, variables) => {
      setCreateDirectoryOpen(false)
      setNewDirectoryName('')
      setUserPath(normalizeDocumentPath(variables.path))
      invalidateBrowserQueries()
    },
    onError: (error) => {
      toast.error('Failed to create directory', { description: error.message })
    },
  })

  const renameMutation = trpc.documents.update.useMutation({
    onSuccess: (doc) => {
      setRenameTarget(null)
      setRenameName('')
      invalidateBrowserQueries()
      utils.documents.get.invalidate({ projectId, id: doc.id })
    },
    onError: (error) => {
      toast.error('Failed to rename document', { description: error.message })
    },
  })

  const moveDocumentMutation = trpc.documents.move.useMutation({
    onSuccess: (doc) => {
      setMoveTarget(null)
      setMoveDestination('')
      invalidateBrowserQueries()
      utils.documents.get.invalidate({ projectId, id: doc.id })
    },
    onError: (error) => {
      toast.error('Failed to move document', { description: error.message })
    },
  })

  const moveDirectoryMutation = trpc.documents.moveDirectory.useMutation({
    onSuccess: (result, variables) => {
      setMoveTarget(null)
      setMoveDestination('')
      invalidateBrowserQueries()
      for (const documentId of result.movedDocumentIds) {
        utils.documents.get.invalidate({ projectId, id: documentId })
      }

      if (isPathInsideDirectory(currentPath, variables.sourcePath)) {
        setUserPath(
          remapPathInsideDirectory(currentPath, variables.sourcePath, result.destinationPath)
        )
      }
    },
    onError: (error) => {
      toast.error('Failed to move directory', { description: error.message })
    },
  })

  const deleteMutation = trpc.documents.delete.useMutation({
    onSuccess: (_result, variables) => {
      setDeleteTarget(null)
      invalidateBrowserQueries()
      utils.documents.get.invalidate({ projectId, id: variables.id })

      if (variables.id === activeDocumentId) {
        const next = visibleDocuments.find((doc) => doc.id !== variables.id)
        if (next) onOpenDocument(next.id)
      }
    },
    onError: (error) => {
      toast.error('Failed to delete document', { description: error.message })
    },
  })

  const deleteDirectoryMutation = trpc.documents.deleteDirectory.useMutation({
    onSuccess: (result, variables) => {
      setDeleteTarget(null)
      invalidateBrowserQueries()
      for (const documentId of result.deletedDocumentIds) {
        utils.documents.get.invalidate({ projectId, id: documentId })
      }

      const deletedIds = new Set(result.deletedDocumentIds)
      if (activeDocumentId && deletedIds.has(activeDocumentId)) {
        const next = visibleDocuments.find((doc) => {
          return !deletedIds.has(doc.id)
        })
        if (next) onOpenDocument(next.id)
      }

      if (isPathInsideDirectory(currentPath, variables.path)) {
        setUserPath(parentPath(variables.path))
      }
    },
    onError: (error) => {
      toast.error('Failed to delete directory', { description: error.message })
    },
  })

  const importMutation = trpc.documents.import.useMutation({
    onSuccess: (doc) => {
      invalidateBrowserQueries()
      utils.documents.get.invalidate({ projectId, id: doc.id })
      onOpenDocument(doc.id)
    },
    onError: (error) => {
      toast.error('Failed to import document', { description: error.message })
    },
  })

  const importSplitMutation = trpc.documents.importSplit.useMutation()

  const documentSettingsQuery = trpc.indexing.getDocument.useQuery(
    {
      projectId,
      id: settingsDocumentId ?? '',
    },
    {
      enabled: settingsDocumentId !== null,
    }
  )

  const updateDocumentSettingsMutation = trpc.indexing.updateDocument.useMutation({
    onSuccess: async (_result, variables) => {
      await Promise.all([
        utils.indexing.getDocument.invalidate({ projectId, id: variables.id }),
        utils.indexing.getProject.invalidate({ projectId }),
      ])
      toast.success('Document indexing strategy updated')
      setSettingsDocumentId(null)
    },
    onError: (error) => {
      toast.error('Failed to update document indexing strategy', {
        description: error.message,
      })
    },
  })

  const handleCreateDocument = useCallback(() => {
    const trimmed = newDocumentName.trim()
    if (!trimmed) return
    if (trimmed.includes('/')) {
      toast.error('Document name cannot include slashes')
      return
    }

    const nextPath = normalizeDocumentPath(currentPath ? `${currentPath}/${trimmed}` : trimmed)
    if (!nextPath) return

    if (documentPathSet.has(nextPath)) {
      toast.error('A document with this path already exists')
      return
    }

    if (isDirectoryPathTaken(nextPath)) {
      toast.error('A directory with this path already exists')
      return
    }

    createMutation.mutate({ projectId, title: nextPath })
  }, [
    createMutation,
    currentPath,
    documentPathSet,
    isDirectoryPathTaken,
    newDocumentName,
    projectId,
  ])

  const handleCreateDirectory = useCallback(() => {
    const trimmed = newDirectoryName.trim()
    if (!trimmed) return
    if (trimmed.includes('/')) {
      toast.error('Directory name cannot include slashes')
      return
    }

    const nextPath = normalizeDocumentPath(currentPath ? `${currentPath}/${trimmed}` : trimmed)
    if (!nextPath) return

    if (documentPathSet.has(nextPath)) {
      toast.error('A document with this path already exists')
      return
    }

    if (isDirectoryPathTaken(nextPath)) {
      toast.error('Directory already exists')
      return
    }

    createDirectoryMutation.mutate({ projectId, path: nextPath })
  }, [
    createDirectoryMutation,
    currentPath,
    documentPathSet,
    isDirectoryPathTaken,
    newDirectoryName,
    projectId,
  ])

  const handleRename = useCallback(() => {
    if (!renameTarget) return

    const trimmed = renameName.trim()
    if (!trimmed) return
    if (trimmed.includes('/')) {
      toast.error(
        `${renameTarget.type === 'directory' ? 'Directory' : 'Document'} name cannot include slashes`
      )
      return
    }

    if (renameTarget.type === 'document') {
      const sourcePath = normalizeDocumentPath(renameTarget.document.title)
      const targetPath = normalizeDocumentPath(
        parentPath(sourcePath) ? `${parentPath(sourcePath)}/${trimmed}` : trimmed
      )
      if (!targetPath) return

      if (targetPath !== sourcePath && documentPathSet.has(targetPath)) {
        toast.error('A document with this path already exists')
        return
      }
      if (targetPath !== sourcePath && isDirectoryPathTaken(targetPath)) {
        toast.error('A directory with this path already exists')
        return
      }

      renameMutation.mutate({
        projectId,
        id: renameTarget.document.id,
        title: targetPath,
      })
      return
    }

    const sourcePath = normalizeDocumentPath(renameTarget.path)
    const targetPath = normalizeDocumentPath(
      parentPath(sourcePath) ? `${parentPath(sourcePath)}/${trimmed}` : trimmed
    )
    if (!targetPath) return

    if (targetPath !== sourcePath && documentPathSet.has(targetPath)) {
      toast.error('A document with this path already exists')
      return
    }

    if (targetPath !== sourcePath && isDirectoryPathTaken(targetPath)) {
      toast.error('A directory with this path already exists')
      return
    }

    moveDirectoryMutation.mutate(
      {
        projectId,
        sourcePath,
        destinationPath: targetPath,
      },
      {
        onSuccess: () => {
          setRenameTarget(null)
          setRenameName('')
        },
      }
    )
  }, [
    documentPathSet,
    isDirectoryPathTaken,
    moveDirectoryMutation,
    projectId,
    renameMutation,
    renameName,
    renameTarget,
  ])

  const handleMove = useCallback(() => {
    if (!moveTarget) return

    const destinationDirectory = normalizeDestination(moveDestination)

    if (moveTarget.type === 'document') {
      const sourcePath = normalizeDocumentPath(moveTarget.document.title)
      const fileName = basename(sourcePath)
      const destinationPath = normalizeDocumentPath(
        destinationDirectory ? `${destinationDirectory}/${fileName}` : fileName
      )
      if (!destinationPath) return

      if (destinationPath !== sourcePath && documentPathSet.has(destinationPath)) {
        toast.error('A document with this path already exists')
        return
      }

      moveDocumentMutation.mutate({
        projectId,
        id: moveTarget.document.id,
        path: destinationPath,
      })
      return
    }

    const sourcePath = normalizeDocumentPath(moveTarget.path)
    const directoryName = basename(sourcePath)
    const destinationPath = normalizeDocumentPath(
      destinationDirectory ? `${destinationDirectory}/${directoryName}` : directoryName
    )
    if (!destinationPath) return

    if (destinationPath !== sourcePath && documentPathSet.has(destinationPath)) {
      toast.error('A document with this path already exists')
      return
    }
    if (destinationPath !== sourcePath && isDirectoryPathTaken(destinationPath)) {
      toast.error('A directory with this path already exists')
      return
    }

    moveDirectoryMutation.mutate({
      projectId,
      sourcePath,
      destinationPath,
    })
  }, [
    documentPathSet,
    isDirectoryPathTaken,
    moveDestination,
    moveDirectoryMutation,
    moveDocumentMutation,
    moveTarget,
    projectId,
  ])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeData = event.active.data.current as DragData | undefined
      const dropData = parseDropData(event.over?.data.current)

      if (!activeData || !dropData) return

      const destinationDirectory =
        dropData.kind === 'root' ? '' : normalizeDocumentPath(dropData.path)

      if (activeData.kind === 'document') {
        const sourcePath = normalizeDocumentPath(activeData.path)
        const fileName = basename(sourcePath)
        const destinationPath = normalizeDocumentPath(
          destinationDirectory ? `${destinationDirectory}/${fileName}` : fileName
        )

        if (!destinationPath || destinationPath === sourcePath) return
        if (documentPathSet.has(destinationPath)) return

        moveDocumentMutation.mutate({
          projectId,
          id: activeData.id,
          path: destinationPath,
        })
        return
      }

      const sourcePath = normalizeDocumentPath(activeData.path)
      const directoryName = basename(sourcePath)
      const destinationPath = normalizeDocumentPath(
        destinationDirectory ? `${destinationDirectory}/${directoryName}` : directoryName
      )

      if (!destinationPath || destinationPath === sourcePath) return
      if (documentPathSet.has(destinationPath)) return

      moveDirectoryMutation.mutate({
        projectId,
        sourcePath,
        destinationPath,
      })
    },
    [documentPathSet, moveDirectoryMutation, moveDocumentMutation, projectId]
  )

  const handleRenameDocument = useCallback(
    (documentId: string) => {
      const document = findDocumentById(documentId)
      if (!document) return

      setRenameTarget({ type: 'document', document })
      setRenameName(basename(normalizeDocumentPath(document.title)))
    },
    [findDocumentById]
  )

  const handleMoveDocument = useCallback(
    (documentId: string) => {
      const document = findDocumentById(documentId)
      if (!document) return

      const sourcePath = normalizeDocumentPath(document.title)
      setMoveTarget({ type: 'document', document })
      setMoveDestination(parentPath(sourcePath))
    },
    [findDocumentById]
  )

  const handleDeleteDocument = useCallback(
    (documentId: string) => {
      const document = findDocumentById(documentId)
      if (!document) return

      setDeleteTarget({ type: 'document', document })
    },
    [findDocumentById]
  )

  const handleSettingsDocument = useCallback(
    (documentId: string) => {
      const document = findDocumentById(documentId)
      if (!document) return
      setSettingsDocumentId(document.id)
    },
    [findDocumentById]
  )

  const settingsDocumentTitle = useMemo(() => {
    if (!settingsDocumentId) return ''
    return findDocumentById(settingsDocumentId)?.title ?? ''
  }, [findDocumentById, settingsDocumentId])

  const handleSaveDocumentSettings = useCallback(
    (strategy: IndexingStrategy | null) => {
      if (!settingsDocumentId) return

      updateDocumentSettingsMutation.mutate({
        projectId,
        id: settingsDocumentId,
        strategy,
      })
    },
    [projectId, settingsDocumentId, updateDocumentSettingsMutation]
  )

  const handleExportDocument = useCallback(
    async (documentId: string) => {
      try {
        const result = await utils.documents.export.fetch({ projectId, id: documentId })
        const blob = new Blob([result.markdown], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = result.title || 'document.md'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      } catch (error) {
        toast.error('Failed to export document', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [projectId, utils.documents.export]
  )

  const handleImportDocument = useCallback(
    async (file: File) => {
      const fileName = file.name.endsWith('.md') ? file.name : `${file.name}.md`
      const targetPath = currentPath ? `${currentPath}/${fileName}` : fileName

      try {
        const content = await file.text()
        let limits: ImportLimits
        try {
          limits = await loadImportLimits()
        } catch (error) {
          toast.error('Failed to load import limits', {
            description: error instanceof Error ? error.message : 'Unknown error',
          })
          return
        }

        const hardLimit = limits.docImportChars
        if (content.length <= hardLimit) {
          importMutation.mutate({ projectId, title: targetPath, markdown: content })
          return
        }

        setImportDraft({ fileName, markdown: content })
        setImportDialogOpen(true)
      } catch (error) {
        toast.error('Failed to read file', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [currentPath, importMutation, loadImportLimits, projectId]
  )

  const handleCancelImport = useCallback(() => {
    if (importSplitMutation.isPending) {
      toast.message('Import is running on the server and cannot be cancelled from the browser.')
      return
    }
    setImportDialogOpen(false)
  }, [importSplitMutation.isPending])

  const handleConfirmImportDraft = useCallback(async () => {
    if (!importDraft) return

    let limits: ImportLimits
    try {
      limits = await loadImportLimits()
    } catch (error) {
      toast.error('Failed to load import limits', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      return
    }

    setImportProgress({ total: 0, imported: 0, failed: 0, isRunning: true })

    try {
      const estimatedPayloadBytes = estimatePayloadBytes({
        projectId,
        fileName: importDraft.fileName,
        markdown: importDraft.markdown,
        destinationDirectory: currentPath,
        split: importSplitMode,
        headingLevel: importHeadingLevel,
        targetDocChars: Math.min(importTargetChars, limits.docImportChars),
        rawHtmlMode: importRawHtmlMode,
        includeContents: importIncludeContents,
      })
      if (estimatedPayloadBytes > limits.transferMaxBytes) {
        toast.error('Import payload is too large for a single request', {
          description:
            `Estimated payload is ${estimatedPayloadBytes.toLocaleString()} bytes, ` +
            `limit is ${limits.transferMaxBytes.toLocaleString()} bytes. ` +
            'Use a smaller file or split the import into smaller chunks.',
        })
        setImportProgress({ total: 0, imported: 0, failed: 0, isRunning: false })
        return
      }

      const result = await importSplitMutation.mutateAsync({
        projectId,
        fileName: importDraft.fileName,
        markdown: importDraft.markdown,
        destinationDirectory: currentPath,
        split: importSplitMode,
        headingLevel: importHeadingLevel,
        targetDocChars: Math.min(importTargetChars, limits.docImportChars),
        rawHtmlMode: importRawHtmlMode,
        includeContents: importIncludeContents,
      })

      setImportProgress({
        total: result.total,
        imported: 0,
        failed: 0,
        isRunning: false,
      })

      toast.success('Import queued', {
        description: `${result.total} documents scheduled for background import.`,
      })
      invalidateBrowserQueries()
      setImportDialogOpen(false)
      setImportDraft(null)
    } catch (error) {
      toast.error('Import failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setImportProgress((prev) => ({ ...prev, isRunning: false }))
    }
  }, [
    currentPath,
    importDraft,
    importHeadingLevel,
    importIncludeContents,
    importSplitMutation,
    importSplitMode,
    importTargetChars,
    importRawHtmlMode,
    invalidateBrowserQueries,
    loadImportLimits,
    projectId,
  ])

  const handleRenameDirectory = useCallback((path: string) => {
    setRenameTarget({ type: 'directory', path })
    setRenameName(basename(path))
  }, [])

  const handleMoveDirectory = useCallback((path: string) => {
    setMoveTarget({ type: 'directory', path })
    setMoveDestination(parentPath(path))
  }, [])

  const handleDeleteDirectory = useCallback((path: string) => {
    setDeleteTarget({ type: 'directory', path })
  }, [])

  const toggleSortDirection = useCallback(() => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }, [])

  const handleRowClick = useCallback(
    (row: BrowserRow) => {
      if (row.type === 'directory') {
        setUserPath(row.path)
        return
      }

      onOpenDocument(row.id)
    },
    [onOpenDocument]
  )

  const goToCrumb = useCallback(
    (index: number) => {
      if (index < 0) {
        setUserPath('')
        return
      }

      setUserPath(breadcrumbs.slice(0, index + 1).join('/'))
    },
    [breadcrumbs]
  )

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return

    if (deleteTarget.type === 'document') {
      deleteMutation.mutate({
        projectId,
        id: deleteTarget.document.id,
      })
      return
    }

    deleteDirectoryMutation.mutate({
      projectId,
      path: deleteTarget.path,
    })
  }, [deleteDirectoryMutation, deleteMutation, deleteTarget, projectId])

  const renameDescription =
    renameTarget?.type === 'directory'
      ? 'Change the folder name. Parent directory stays the same.'
      : 'Change the file name. Parent directory stays the same.'

  const deleteDescription =
    deleteTarget?.type === 'document'
      ? `"${normalizeDocumentPath(deleteTarget.document.title)}" will be permanently deleted.`
      : deleteTarget?.type === 'directory'
        ? `"${deleteTarget.path}" and all its contents will be permanently deleted.`
        : ''

  const isBusy =
    createMutation.isPending ||
    createDirectoryMutation.isPending ||
    renameMutation.isPending ||
    moveDocumentMutation.isPending ||
    moveDirectoryMutation.isPending ||
    deleteMutation.isPending ||
    deleteDirectoryMutation.isPending

  return {
    sensors,
    handleDragEnd,
    setRootDropRef,
    isOverRoot,
    isLoading,
    isSearchActive,
    isSemanticSearchActive,
    isSearchLoading: searchResultsQuery.isFetching,
    searchQuery,
    setSearchQuery,
    clearSearch: () => setSearchQuery(''),
    searchMode,
    setSearchMode,
    searchScope,
    setSearchScope,
    searchResultCount: isSemanticSearchActive
      ? searchRows.length
      : isFilterActive
        ? filterRows.length
        : 0,
    emptyMessage: isSemanticSearchActive
      ? 'No semantic matches found.'
      : isFilterActive
        ? 'No documents match this filter.'
        : 'No documents in this directory.',
    rows,
    breadcrumbs,
    sortField,
    setSortField,
    sortDirection,
    toggleSortDirection,
    currentPath,
    createDocumentOpen,
    setCreateDocumentOpen,
    newDocumentName,
    setNewDocumentName,
    handleCreateDocument,
    createDirectoryOpen,
    setCreateDirectoryOpen,
    newDirectoryName,
    setNewDirectoryName,
    handleCreateDirectory,
    renameTarget,
    setRenameTarget,
    renameName,
    setRenameName,
    handleRename,
    renameDescription,
    moveTarget,
    setMoveTarget,
    moveDestination,
    setMoveDestination,
    handleMove,
    deleteTarget,
    setDeleteTarget,
    deleteDescription,
    handleConfirmDelete,
    handleRowClick,
    goToCrumb,
    isBusy,
    handleImportDocument,
    importDialogOpen,
    setImportDialogOpen,
    importDraftFileName: importDraft?.fileName ?? null,
    importSplitMode,
    setImportSplitMode,
    importHeadingLevel,
    setImportHeadingLevel,
    importTargetChars,
    setImportTargetChars,
    importRawHtmlMode,
    setImportRawHtmlMode,
    importIncludeContents,
    setImportIncludeContents,
    importProgress,
    confirmImportDraft: handleConfirmImportDraft,
    cancelImportDraft: handleCancelImport,
    settingsDocumentId,
    settingsDocumentTitle,
    setSettingsDocumentId,
    documentSettings: documentSettingsQuery.data,
    isLoadingDocumentSettings: documentSettingsQuery.isLoading,
    saveDocumentSettings: handleSaveDocumentSettings,
    isSavingDocumentSettings: updateDocumentSettingsMutation.isPending,
    isImporting:
      importMutation.isPending || importSplitMutation.isPending || importProgress.isRunning,
    isCreatingDocument: createMutation.isPending,
    isCreatingDirectory: createDirectoryMutation.isPending,
    isRenaming: renameMutation.isPending || moveDirectoryMutation.isPending,
    isMoving: moveDocumentMutation.isPending || moveDirectoryMutation.isPending,
    isDeleting: deleteMutation.isPending || deleteDirectoryMutation.isPending,
    // Row action callbacks for DocumentList
    handleRenameDocument,
    handleMoveDocument,
    handleSettingsDocument,
    handleDeleteDocument,
    handleExportDocument,
    handleRenameDirectory,
    handleMoveDirectory,
    handleDeleteDirectory,
  }
}
