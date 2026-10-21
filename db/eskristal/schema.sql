-- Skema inti tenant Es Kristal (89 tabel + 2 modul SQL).
-- DIHASILKAN OTOMATIS oleh scripts/saas-dump-eskristal-schema.ts -- jangan edit manual.
-- Pemisah batch: baris "GO".

CREATE TABLE [dbo].[Approval] (
  [ApprovalID] varchar(16) NOT NULL,
  [Type] varchar(128) NULL,
  [TypeID] varchar(16) NULL,
  [UserID] varchar(16) NULL,
  [Status] varchar(16) NULL,
  [Notes] varchar(128) NULL,
  [TransDate] datetime NULL,
  [ModifiedDate] datetime NULL,
  [IsDeleted] bit NULL,
  [Timestamp] timestamp NULL,
  CONSTRAINT [PK_Approval] PRIMARY KEY CLUSTERED ([ApprovalID])
);
GO

CREATE TABLE [dbo].[BusinessPartner] (
  [BusinessPartnerID] varchar(16) NOT NULL,
  [Code] varchar(128) NULL,
  [Name] varchar(128) NULL,
  [ContactPerson] varchar(128) NULL,
  [Email] varchar(128) NULL,
  [FaxNo] varchar(50) NULL,
  [MobileNo] varchar(128) NULL,
  [NPWP] varchar(128) NULL,
  [NPWPName] varchar(128) NULL,
  [PhoneNo] varchar(128) NULL,
  [Address] varchar(1024) NULL,
  [WebPage] varchar(50) NULL,
  [IsLoan] bit NULL,
  [IsSuspended] bit NULL,
  [IsTax] bit NULL,
  [Notes] varchar(1024) NULL,
  [NPWPAddress] varchar(128) NULL,
  [DateOfBirth] datetime NULL,
  [JoinDate] datetime NULL,
  [ClusterID] varchar(50) NULL,
  [Gender] varchar(50) NULL,
  [GroupBusinessPartner] varchar(128) NULL,
  [PriceLevel] int NULL,
  [AccountPayableID] varchar(16) NULL,
  [AccountReceivableID] varchar(16) NULL,
  [SalesDiscID] varchar(16) NULL,
  [PurchaseDiscID] varchar(16) NULL,
  [ServiceTaxID] varchar(16) NULL,
  [TaxInID] varchar(16) NULL,
  [TaxOutID] varchar(16) NULL,
  [TermOfPaymentID] varchar(16) NULL,
  [Limit] decimal(23,6) NULL,
  [IsIncludeTax] bit NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [SalesmanID] varchar(16) NULL,
  [Title] varchar(128) NULL,
  [Timestamp] timestamp NULL,
  [Salesman] varchar(50) NULL,
  [PurchaseDepositID] varchar(16) NULL,
  [SalesDepositID] varchar(16) NULL,
  [AccountReceiveableID] varchar(50) NULL,
  [MemberID] varchar(16) NULL,
  [ExpiredMemberDate] datetime NULL,
  [Compensation] decimal(24,10) NULL,
  [IdentityNo] varchar(50) NULL,
  [Prefix] varchar(62) NULL,
  [SalesDisc] varchar(50) NULL,
  [Capacity] decimal(23,4) NULL,
  CONSTRAINT [PK_BusinessPartner] PRIMARY KEY CLUSTERED ([BusinessPartnerID])
);
GO

CREATE TABLE [dbo].[ChartOfAccount] (
  [ChartOfAccountID] varchar(16) NOT NULL,
  [GroupAccountID] varchar(16) NULL,
  [AccountNo] varchar(128) NULL,
  [Description] varchar(128) NULL,
  [ParentID] varchar(16) NULL,
  [IsChildest] bit NULL,
  [IsDeleted] bit NULL,
  [Type] varchar(16) NULL,
  [IsBank] bit NULL,
  [IsCard] bit NULL,
  [Type2] varchar(16) NULL,
  [ModifiedDate] datetime NULL,
  [Timestamp] timestamp NULL,
  [CostBehavior] varchar(10) NULL,
  CONSTRAINT [PK_ChartOfAccount] PRIMARY KEY CLUSTERED ([ChartOfAccountID])
);
GO

CREATE TABLE [dbo].[DeliveryOrder] (
  [DeliveryOrderID] varchar(16) NOT NULL,
  [VoucherNo] varchar(128) NULL,
  [TransDate] datetime NULL,
  [BranchID] varchar(16) NULL,
  [DepartmentID] varchar(16) NULL,
  [BusinessPartnerID] varchar(16) NULL,
  [Notes] varchar(1024) NULL,
  [SalesOrderID] varchar(16) NULL,
  [IsClosed] bit NULL,
  [ExpeditionID] varchar(50) NULL,
  [VehicleNo] varchar(50) NULL,
  [AddressDelivery] varchar(150) NULL,
  [IsDeleted] bit NOT NULL,
  [ModifiedDate] datetime NOT NULL,
  [PIC] varchar(128) NULL,
  [ShippingNo] varchar(50) NULL,
  [BusinessPartnerLocationID] varchar(50) NULL,
  [IsInvoiced] bit NULL,
  [CurrencyID] varchar(16) NULL,
  [Rate] decimal(23,10) NULL,
  [StatusForm] int NULL,
  [SalesmanID] varchar(16) NULL,
  [Timestamp] timestamp NULL,
  [OverLimit] bit NULL,
  [ReferenceNo] varchar(150) NULL,
  [DueDate] datetime NULL,
  [ProjectID] varchar(16) NULL,
  [AddressDeliveryID] varchar(50) NULL,
  [IsDOReturn] bit NULL,
  CONSTRAINT [PK_DeliveryOrder] PRIMARY KEY CLUSTERED ([DeliveryOrderID])
);
GO

CREATE TABLE [dbo].[DeliveryOrderDetail] (
  [DeliveryOrderDetailID] varchar(16) NOT NULL,
  [DeliveryOrderID] varchar(16) NULL,
  [ItemID] varchar(160) NULL,
  [Qty] decimal(23,4) NULL,
  [Unit] varchar(8) NULL,
  [UnitRatio] decimal(23,4) NULL,
  [Ratio] decimal(23,4) NULL,
  [Price] decimal(23,4) NULL,
  [Disc] decimal(23,4) NULL,
  [DiscValue] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [Amount] decimal(23,4) NULL,
  [Delivered] decimal(23,4) NULL,
  [Name] varchar(160) NULL,
  [Outstanding] decimal(18,0) NULL,
  [Description] varchar(50) NULL,
  [Cashback] decimal(18,10) NULL,
  [SalesOrderDetailID] varchar(16) NULL,
  CONSTRAINT [PK_DeliveryOrderDetail] PRIMARY KEY CLUSTERED ([DeliveryOrderDetailID])
);
GO

CREATE TABLE [dbo].[Expedition] (
  [ExpeditionID] varchar(16) NOT NULL,
  [Name] varchar(128) NULL,
  [ContactPerson] varchar(128) NULL,
  [Address] varchar(128) NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [PhoneNo] varchar(16) NULL,
  [TimeStamp] timestamp NULL,
  CONSTRAINT [PK_Expedition] PRIMARY KEY CLUSTERED ([ExpeditionID])
);
GO

CREATE TABLE [dbo].[ExpeditionDetail] (
  [ExpeditionDetailID] varchar(16) NOT NULL,
  [ExpeditionID] varchar(16) NULL,
  [VehicleNo] varchar(16) NULL,
  [Description] varchar(256) NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [Timestamp] timestamp NULL,
  CONSTRAINT [PK_ExpeditionDetail] PRIMARY KEY CLUSTERED ([ExpeditionDetailID])
);
GO

CREATE TABLE [dbo].[GeneralLedger] (
  [ID] varchar(16) NULL,
  [BranchID] varchar(16) NULL,
  [DepartmentID] varchar(16) NULL,
  [VoucherNo] varchar(512) NULL,
  [TransDate] datetime NULL,
  [Type] varchar(128) NULL,
  [ChartOfAccountID] varchar(16) NULL,
  [Debit] decimal(23,10) NULL,
  [Credit] decimal(23,10) NULL,
  [Memo] varchar(MAX) NULL,
  [BusinessPartnerID] varchar(16) NULL,
  [CurrencyID] varchar(16) NULL,
  [Rate] decimal(23,10) NULL
);
GO

CREATE TABLE [dbo].[Item] (
  [ItemID] varchar(16) NOT NULL,
  [Code] varchar(16) NULL,
  [Name] varchar(128) NULL,
  [GroupItem] varchar(128) NULL,
  [Unit1] varchar(8) NULL,
  [Unit2] varchar(8) NULL,
  [Unit3] varchar(8) NULL,
  [Ratio2] float NULL,
  [Ratio3] float NULL,
  [BuyPrice1] decimal(23,4) NULL,
  [BuyPrice2] decimal(23,4) NULL,
  [BuyPrice3] decimal(23,4) NULL,
  [CategoryID] varchar(16) NULL,
  [BrandID] varchar(16) NULL,
  [ItemImage] varbinary(MAX) NULL,
  [UnitPrice1] decimal(23,4) NULL,
  [UnitPrice2] decimal(23,4) NULL,
  [UnitPrice3] decimal(23,4) NULL,
  [UnitPrice4] decimal(23,4) NULL,
  [UnitPrice5] decimal(23,4) NULL,
  [Notes] varchar(128) NULL,
  [IsSuspended] bit NULL,
  [IsSellable] bit NULL,
  [COGSID] varchar(16) NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [Purchase] varchar(16) NULL,
  [Sales] varchar(16) NULL,
  [ItemDelivered] varchar(16) NULL,
  [ItemReceived] varchar(16) NULL,
  [GRIR] varchar(16) NULL,
  [Timestamp] timestamp NULL,
  [SectionID] varchar(16) NULL,
  [ItemTypeID] varchar(16) NULL,
  [Custom1] varchar(160) NULL,
  [Custom2] varchar(160) NULL,
  [Custom3] varchar(160) NULL,
  [MinQty] decimal(24,10) NULL,
  [Concerned] bit NULL,
  [Seq] int NULL,
  [UnitPrice6] decimal(23,4) NULL,
  [DepartmentID] varchar(50) NULL,
  [IsFloatingQty] bit NULL,
  [IsIncrease] bit NULL,
  [IsDecrease] bit NULL,
  [MultiplyPackage] decimal(23,10) NULL,
  [MemberID] varchar(16) NULL,
  [SerialNumber] bit NULL,
  [IsBuyable] bit NULL,
  [BarCode] varchar(250) NULL,
  [SubCategoryID] varchar(50) NULL,
  [Length] decimal(23,10) NULL,
  [Width] decimal(23,10) NULL,
  [Grammage] decimal(23,10) NULL,
  [Height] decimal(23,10) NULL,
  [Size] varchar(50) NULL,
  [InventoryID] varchar(16) NULL,
  [TSalesID] varchar(16) NULL,
  [NSalesID] varchar(20) NULL,
  [GRIRID] varchar(16) NULL,
  [UnitPrice7] decimal(23,4) NULL,
  [Status] varchar(5) NULL,
  [GroupCategoryID] varchar(50) NULL,
  [ProductCategoryID] varchar(50) NULL,
  [VarianID] varchar(50) NULL,
  [PartCategoryID] varchar(50) NULL,
  [WorkCentreID] varchar(50) NULL,
  [ResultID] varchar(50) NULL,
  [PurchaseCategoryID] varchar(50) NULL,
  [PurchaseSubCategoryID] varchar(50) NULL,
  [PurchaseItemID] varchar(50) NULL,
  [PurchaseTypeID] varchar(50) NULL,
  [PurchaseManufacturerID] varchar(50) NULL,
  [PurchaseBrandGradeID] varchar(50) NULL,
  [UnitPrice8] decimal(23,4) NULL,
  CONSTRAINT [PK_Item] PRIMARY KEY CLUSTERED ([ItemID])
);
GO

CREATE TABLE [dbo].[ItemAverage] (
  [ItemAverageID] varchar(16) NULL,
  [Year] int NULL,
  [Month] int NULL,
  [ItemID] varchar(16) NULL,
  [Average] decimal(23,10) NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [Timestamp] timestamp NULL,
  [AverageDiff] decimal(23,10) NULL
);
GO

CREATE TABLE [dbo].[SalesInvoice] (
  [SalesInvoiceID] varchar(16) NOT NULL,
  [VoucherNo] varchar(128) NULL,
  [ReferenceNo] varchar(128) NULL,
  [TaxNo] varchar(128) NULL,
  [TransDate] datetime NULL,
  [DueDate] datetime NULL,
  [Notes] varchar(1024) NULL,
  [TermOfPaymentID] varchar(16) NULL,
  [SalesOrderID] varchar(50) NULL,
  [DeliveryOrderID] varchar(50) NULL,
  [SalesDepositID] varchar(50) NULL,
  [BusinessPartnerID] varchar(16) NULL,
  [BranchID] varchar(16) NULL,
  [DepartmentID] varchar(16) NULL,
  [Amount] decimal(23,4) NULL,
  [Disc] decimal(23,4) NULL,
  [DiscValue] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [Tax] decimal(23,4) NULL,
  [TaxValue] decimal(23,4) NULL,
  [Netto] decimal(23,4) NULL,
  [BankID] varchar(50) NULL,
  [Paid] decimal(23,4) NULL,
  [Deposit] decimal(23,4) NULL,
  [PaidDate] datetime NULL,
  [IsClosed] bit NULL,
  [IsDeleted] bit NOT NULL,
  [ModifiedDate] datetime NOT NULL,
  [Rate] decimal(23,4) NULL,
  [CurrencyID] varchar(16) NULL,
  [IsAccountReceiveable] bit NULL,
  [StatusForm] int NULL,
  [SalesmanID] varchar(16) NULL,
  [Timestamp] timestamp NULL,
  [ServiceTax] decimal(23,4) NULL,
  [ServiceTaxValue] decimal(28,10) NULL,
  [Visitor] int NULL,
  [IsTX] bit NULL,
  [PromotionID] varchar(50) NULL,
  [IsPerforma] bit NULL,
  [Description] varchar(526) NULL,
  [IsPerfoma] bit NULL,
  [DiscRpBefore] decimal(18,10) NULL,
  [ProjectID] varchar(16) NULL,
  [IsExported] bit NULL,
  [BillOfQuantityID] varchar(16) NULL,
  [Freight] decimal(18,10) NULL,
  [TaxDate] datetime NULL,
  [IsDirectPO] bit NULL,
  [ExpeditionID] varchar(16) NULL,
  [VehicleID] varchar(16) NULL,
  [OtherInvoice] bit NULL,
  [Periode] varchar(526) NULL,
  [Performa] int NULL,
  [ispeforma] bit NULL,
  CONSTRAINT [PK_SalesInvoice] PRIMARY KEY CLUSTERED ([SalesInvoiceID])
);
GO

CREATE TABLE [dbo].[SalesInvoiceChangeLog] (
  [LogID] int IDENTITY(1,1) NOT NULL,
  [SalesInvoiceID] int NOT NULL,
  [ChangeType] varchar(10) NOT NULL,
  [ChangedAt] datetime NOT NULL DEFAULT (getdate()),
  [IsProcessed] bit NOT NULL DEFAULT ((0)),
  [ProcessedAt] datetime NULL,
  PRIMARY KEY CLUSTERED ([LogID])
);
GO

CREATE TABLE [dbo].[SalesInvoiceDetail] (
  [SalesInvoiceDetailID] varchar(16) NOT NULL,
  [SalesInvoiceID] varchar(16) NULL,
  [ItemID] varchar(160) NULL,
  [Qty] decimal(23,4) NULL,
  [Unit] varchar(8) NULL,
  [Ratio] decimal(23,4) NULL,
  [UnitRatio] decimal(23,4) NULL,
  [Price] decimal(23,4) NULL,
  [Disc] decimal(23,4) NULL,
  [DiscValue] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [Amount] decimal(23,4) NULL,
  [Name] varchar(150) NULL,
  [Value] decimal(23,4) NULL,
  [Netto] decimal(23,4) NULL,
  [Description] varchar(MAX) NULL,
  [WaiterName] varchar(1024) NULL,
  [Cashback] decimal(18,10) NULL,
  [Total] decimal(23,4) NULL,
  CONSTRAINT [PK_SalesInvoiceDetail] PRIMARY KEY CLUSTERED ([SalesInvoiceDetailID])
);
GO

CREATE TABLE [dbo].[SalesOrder] (
  [SalesOrderID] varchar(16) NOT NULL,
  [VoucherNo] varchar(128) NULL,
  [ReferenceNo] varchar(128) NULL,
  [TransDate] datetime NULL,
  [DueDate] datetime NULL,
  [BranchID] varchar(16) NULL,
  [DepartmentID] varchar(16) NULL,
  [BusinessPartnerID] varchar(16) NULL,
  [TermOfPaymentID] varchar(16) NULL,
  [AddressInvoice] varchar(128) NULL,
  [AddressDelivery] varchar(128) NULL,
  [AddressDeliveryID] varchar(16) NULL,
  [CurrencyID] varchar(16) NULL,
  [IsClosed] bit NULL,
  [Notes] varchar(128) NULL,
  [Amount] decimal(23,4) NULL,
  [Disc] decimal(23,4) NULL,
  [DiscValue] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [Tax] decimal(23,4) NULL,
  [TaxValue] decimal(23,4) NULL,
  [Netto] decimal(23,4) NULL,
  [Paid] decimal(23,4) NULL,
  [PaidDate] datetime NULL,
  [IsInvoiced] bit NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [Rate] decimal(23,4) NULL,
  [StatusForm] int NULL,
  [SalesmanID] varchar(16) NULL,
  [Timestamp] timestamp NULL,
  [ServiceTaxValue] decimal(28,10) NULL,
  [ServiceTax] decimal(18,10) NULL,
  [Visitor] int NULL,
  [PromotionID] varchar(50) NULL,
  [QuotationID] varchar(50) NULL,
  [Number] int NULL,
  [DiscRpBefore] decimal(18,10) NULL,
  [ProjectID] varchar(50) NULL,
  [BillOfQuantityID] varchar(16) NULL,
  [Freight] decimal(18,0) NULL,
  [SalesRequestID] varchar(16) NULL,
  [Value] decimal(23,4) NULL,
  [NotesDelivery] varchar(128) NULL,
  [PrintCheck] int NULL,
  [Deadline] datetime NULL,
  [DeliveryMemo] varchar(512) NULL,
  [isperfoma] bit NULL,
  [Status] varchar(16) NULL,
  CONSTRAINT [PK_SalesOrder] PRIMARY KEY CLUSTERED ([SalesOrderID])
);
GO

CREATE TABLE [dbo].[SalesOrderDetail] (
  [SalesOrderDetailID] varchar(16) NOT NULL,
  [SalesOrderID] varchar(16) NULL,
  [ItemID] varchar(150) NULL,
  [Name] varchar(150) NULL,
  [Qty] float NULL,
  [Unit] varchar(16) NULL,
  [Price] float NULL,
  [Disc] float NULL,
  [DiscValue] float NULL,
  [DiscRp] float NULL,
  [Ratio] float NULL,
  [UnitRatio] float NULL,
  [Amount] float NULL,
  [Description] varchar(2050) NULL,
  [Custom1] varchar(2050) NULL,
  [Custom2] varchar(2050) NULL,
  [Custom3] varchar(2050) NULL,
  [WaiterName] varchar(1024) NULL,
  [Cashback] decimal(18,10) NULL,
  [FlagClosed] varchar(5) NULL,
  CONSTRAINT [PK_SalesOrderDetail] PRIMARY KEY CLUSTERED ([SalesOrderDetailID])
);
GO

CREATE TABLE [dbo].[SalesPayment] (
  [SalesPaymentID] varchar(16) NOT NULL,
  [VoucherNo] varchar(128) NULL,
  [TransDate] datetime NULL,
  [Notes] varchar(1024) NULL,
  [BusinessPartnerID] varchar(16) NULL,
  [Amount] decimal(23,4) NULL,
  [Type] int NULL,
  [IsDeleted] bit NOT NULL,
  [ModifiedDate] datetime NOT NULL,
  [ChartOfAccountID] varchar(16) NULL,
  [BranchID] varchar(16) NULL,
  [ChartOfAccountTaxID] varchar(128) NULL,
  [ChartOfAccountExpenseID] varchar(128) NULL,
  [ChartOfAccountDiscID] varchar(128) NULL,
  [CurrencyID] varchar(16) NULL,
  [Rate] decimal(23,10) NULL,
  [SalesmanID] varchar(16) NULL,
  [Timestamp] timestamp NULL,
  [ChartOfAccountDepositID] varchar(128) NULL,
  [DepartmentID] varchar(16) NULL,
  [IsAccountReceiveable] bit NULL,
  [EDC] varchar(50) NULL,
  [CardNo] varchar(50) NULL,
  [ProjectID] varchar(16) NULL,
  [SalesDepositID] varchar(16) NULL,
  [SalesPaymentRequestID] varchar(50) NULL,
  CONSTRAINT [PK_SalesPayment] PRIMARY KEY CLUSTERED ([SalesPaymentID])
);
GO

CREATE TABLE [dbo].[SalesPaymentDetail] (
  [SalesPaymentDetailID] varchar(16) NOT NULL,
  [SalesPaymentID] varchar(16) NULL,
  [SalesInvoiceID] varchar(16) NULL,
  [Amount] decimal(23,4) NULL,
  [Deposit] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [ModifiedDate] datetime NULL,
  [IsDeleted] bit NULL,
  [AddTax] decimal(23,4) NULL,
  [Expense] decimal(23,4) NULL,
  [Timestamp] timestamp NULL,
  [CurrencyID] varchar(16) NULL,
  [Rate] decimal(23,10) NULL,
  [DepositAmount] decimal(23,10) NULL,
  [Status] varchar(100) NULL,
  CONSTRAINT [PK_SalesPaymentDetail] PRIMARY KEY CLUSTERED ([SalesPaymentDetailID])
);
GO

CREATE TABLE [dbo].[SalesReturn] (
  [SalesReturnID] varchar(16) NOT NULL,
  [VoucherNo] varchar(128) NULL,
  [ReferenceNo] varchar(128) NULL,
  [TaxNo] varchar(128) NULL,
  [TransDate] datetime NULL,
  [DueDate] datetime NULL,
  [Notes] varchar(1024) NULL,
  [TermOfPaymentID] varchar(16) NULL,
  [SalesOrderID] varchar(50) NULL,
  [DeliveryOrderID] varchar(50) NULL,
  [SalesDepositID] varchar(50) NULL,
  [BusinessPartnerID] varchar(16) NULL,
  [BranchID] varchar(16) NULL,
  [DepartmentID] varchar(16) NULL,
  [Amount] decimal(23,4) NULL,
  [Disc] decimal(23,4) NULL,
  [DiscValue] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [Tax] decimal(23,4) NULL,
  [TaxValue] decimal(23,4) NULL,
  [Netto] decimal(23,4) NULL,
  [BankID] varchar(50) NULL,
  [Paid] decimal(23,4) NULL,
  [Deposit] decimal(23,4) NULL,
  [PaidDate] datetime NULL,
  [IsClosed] bit NULL,
  [IsDeleted] bit NOT NULL,
  [ModifiedDate] datetime NOT NULL,
  [SalesmanID] varchar(16) NULL,
  [AddressDelivery] varchar(128) NULL,
  [AddressDeliveryID] varchar(128) NULL,
  [CurrencyID] varchar(16) NULL,
  [Rate] decimal(23,10) NULL,
  [AddressInvoice] varchar(128) NULL,
  [IsInvoiced] bit NULL,
  [ProjectID] varchar(50) NULL,
  CONSTRAINT [PK_SalesReturn] PRIMARY KEY CLUSTERED ([SalesReturnID])
);
GO

CREATE TABLE [dbo].[SalesReturnDetail] (
  [SalesReturnDetailID] varchar(16) NOT NULL,
  [SalesReturnID] varchar(16) NULL,
  [ItemID] varchar(160) NULL,
  [Qty] decimal(23,4) NULL,
  [Unit] varchar(8) NULL,
  [Ratio] decimal(23,4) NULL,
  [UnitRatio] decimal(23,4) NULL,
  [Price] decimal(23,4) NULL,
  [Disc] decimal(23,4) NULL,
  [DiscValue] decimal(23,4) NULL,
  [DiscRp] decimal(23,4) NULL,
  [Amount] decimal(23,4) NULL,
  [Name] varchar(150) NULL,
  [Value] decimal(23,4) NULL,
  [Netto] decimal(23,4) NULL,
  [Retur] decimal(23,4) NULL,
  [SalesOrderDetailID] varchar(16) NULL,
  CONSTRAINT [PK_SalesReturnDetail] PRIMARY KEY CLUSTERED ([SalesReturnDetailID])
);
GO

CREATE TABLE [dbo].[Salesman] (
  [SalesmanID] varchar(16) NOT NULL,
  [Code] varchar(16) NULL,
  [Name] varchar(128) NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  CONSTRAINT [PK_Salesman] PRIMARY KEY CLUSTERED ([SalesmanID])
);
GO

CREATE TABLE [dbo].[Server] (
  [ServerID] varchar(16) NOT NULL,
  [Timestamp] timestamp NOT NULL,
  [Name] varchar(128) NULL,
  [ModifiedDate] datetime NOT NULL,
  [IsDeleted] bit NULL,
  CONSTRAINT [PK_Server] PRIMARY KEY CLUSTERED ([ServerID])
);
GO

CREATE TABLE [dbo].[TermOfPayment] (
  [TermOfPaymentID] varchar(16) NOT NULL,
  [TermOfPayment] varchar(128) NULL,
  [Value] float NULL,
  [IsDeleted] bit NULL,
  [ModifiedDate] datetime NULL,
  [Timestamp] timestamp NULL,
  CONSTRAINT [PK_TermOfPayment] PRIMARY KEY CLUSTERED ([TermOfPaymentID])
);
GO

CREATE TABLE [dbo].[Token] (
  [TokenID] varchar(16) NOT NULL,
  [TokenKey] varchar(MAX) NULL,
  [UserID] varchar(16) NULL,
  [IssuedDate] datetime NULL,
  [ExpiredDate] datetime NULL,
  [CreatedDate] datetime NULL,
  [ModifiedDate] datetime NULL,
  [IsDeleted] bit NULL,
  [Timestamp] timestamp NULL,
  CONSTRAINT [PK_Token] PRIMARY KEY CLUSTERED ([TokenID])
);
GO

CREATE TABLE [dbo].[DashboardAktivitasProduksiKehadiran] (
  [AktivitasID] int NOT NULL,
  [AnggotaID] int NOT NULL,
  [Urutan] int NOT NULL DEFAULT ((0)),
  PRIMARY KEY CLUSTERED ([AktivitasID], [AnggotaID])
);
GO

CREATE TABLE [dbo].[DashboardAktivitasProduksiShift] (
  [AktivitasID] int IDENTITY(1,1) NOT NULL,
  [TanggalUsaha] date NOT NULL,
  [Shift] tinyint NOT NULL,
  [ShiftMulai] datetime NOT NULL,
  [StafOperasionalAkunID] int NULL,
  [StokEsSebelumnya10KG] int NOT NULL DEFAULT ((0)),
  [PecahKemasanQty] int NOT NULL DEFAULT ((0)),
  [EsJatuhQty] int NOT NULL DEFAULT ((0)),
  [GantiReturnQty] int NOT NULL DEFAULT ((0)),
  [SealerJebolQty] int NOT NULL DEFAULT ((0)),
  [CreatedByAkunID] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [TimID] int NULL,
  [KepalaHadir] bit NOT NULL DEFAULT ((1)),
  [WakilHadir] bit NOT NULL DEFAULT ((1)),
  PRIMARY KEY CLUSTERED ([AktivitasID]),
  CONSTRAINT [UQ_AktivitasProduksiShift] UNIQUE NONCLUSTERED ([TanggalUsaha], [Shift])
);
GO

CREATE TABLE [dbo].[DashboardArmada] (
  [ArmadaID] int IDENTITY(1,1) NOT NULL,
  [Nama] varchar(128) NOT NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [PlatNomor] varchar(20) NULL,
  [Brand] varchar(64) NULL,
  [Model] varchar(64) NULL,
  [KonsumsiBBM] decimal(10,2) NULL,
  [KapasitasMaks] decimal(23,4) NULL,
  [Status] varchar(20) NOT NULL DEFAULT ('Baik'),
  [FotoPath] varchar(256) NULL,
  [JenisBBM] varchar(20) NULL,
  [BiayaBBMPerLiter] decimal(18,2) NULL,
  [PajakLimaTahunan] date NULL,
  [BiayaPajakLimaTahunan] decimal(18,2) NULL,
  [ExpeditionDetailID] varchar(16) NULL,
  [QrMyPertaminaPath] varchar(256) NULL,
  PRIMARY KEY CLUSTERED ([ArmadaID])
);
GO

CREATE TABLE [dbo].[DashboardArmadaActivity] (
  [ActivityID] int IDENTITY(1,1) NOT NULL,
  [ArmadaID] int NOT NULL,
  [ActivityType] varchar(20) NOT NULL,
  [StartTime] datetime NOT NULL,
  [EndTime] datetime NOT NULL,
  [Notes] varchar(255) NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [CreatedByUserID] varchar(16) NULL,
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([ActivityID])
);
GO

CREATE TABLE [dbo].[DashboardArmadaAlokasi] (
  [ArmadaAlokasiID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [KualitasID] int NOT NULL,
  [Qty] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([ArmadaAlokasiID])
);
GO

CREATE TABLE [dbo].[DashboardBudget] (
  [ChartOfAccountID] varchar(16) NOT NULL,
  [BudgetYear] int NOT NULL,
  [BudgetMonth] int NOT NULL,
  [Amount] decimal(23,4) NOT NULL,
  [CreatedByUserID] varchar(16) NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  CONSTRAINT [PK_DashboardBudget] PRIMARY KEY CLUSTERED ([ChartOfAccountID], [BudgetYear], [BudgetMonth])
);
GO

CREATE TABLE [dbo].[DashboardCashFlowDaily] (
  [BusinessDate] date NOT NULL,
  [KasDiTangan] decimal(23,2) NOT NULL DEFAULT ((0)),
  [PengeluaranKasDiTangan] decimal(23,2) NOT NULL DEFAULT ((0)),
  [UpdatedByUserID] varchar(16) NULL,
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  CONSTRAINT [PK_DashboardCashFlowDaily] PRIMARY KEY CLUSTERED ([BusinessDate])
);
GO

CREATE TABLE [dbo].[DashboardCashFlowExpense] (
  [ID] int IDENTITY(1,1) NOT NULL,
  [BusinessDate] date NOT NULL,
  [Deskripsi] varchar(256) NOT NULL,
  [Nominal] decimal(23,2) NOT NULL,
  [CreatedByUserID] varchar(16) NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  CONSTRAINT [PK_DashboardCashFlowExpense] PRIMARY KEY CLUSTERED ([ID])
);
GO

CREATE TABLE [dbo].[DashboardCollectionTarget] (
  [BusinessPartnerID] varchar(16) NOT NULL,
  [TargetDate] datetime NULL,
  [TargetAmount] decimal(23,4) NULL,
  [Note] varchar(256) NULL,
  [CreatedByUserID] varchar(16) NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([BusinessPartnerID])
);
GO

CREATE TABLE [dbo].[DashboardDocTemplate] (
  [DocType] varchar(30) NOT NULL,
  [PaperSize] varchar(10) NOT NULL DEFAULT ('A5'),
  [CustomWidthMM] decimal(6,1) NULL,
  [CustomHeightMM] decimal(6,1) NULL,
  [HeaderTitle] varchar(150) NULL,
  [HeaderAddress] varchar(255) NULL,
  [LogoPath] varchar(255) NULL,
  [ShowDriverInfo] bit NOT NULL DEFAULT ((1)),
  [ShowArmadaInfo] bit NOT NULL DEFAULT ((1)),
  [ShowBonusColumn] bit NOT NULL DEFAULT ((1)),
  [ShowSignatureBlock] bit NOT NULL DEFAULT ((1)),
  [FooterNotes] varchar(500) NULL,
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([DocType])
);
GO

CREATE TABLE [dbo].[DashboardDriverProfile] (
  [SalesmanID] varchar(16) NOT NULL,
  [TempatLahir] varchar(100) NULL,
  [TanggalLahir] date NULL,
  [NIK] varchar(32) NULL,
  [Alamat] varchar(255) NULL,
  [BergabungSejak] date NULL,
  [HariKerja] varchar(100) NULL,
  [JamMulaiKerja] varchar(5) NULL,
  [JamSelesaiKerja] varchar(5) NULL,
  [IsHiddenFromDropdown] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([SalesmanID])
);
GO

CREATE TABLE [dbo].[DashboardDriverSim] (
  [DriverSimID] int IDENTITY(1,1) NOT NULL,
  [SalesmanID] varchar(16) NOT NULL,
  [JenisSim] varchar(10) NOT NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  PRIMARY KEY CLUSTERED ([DriverSimID])
);
GO

CREATE TABLE [dbo].[DashboardGLPostingBackfill] (
  [BackfillID] int IDENTITY(1,1) NOT NULL,
  [VoucherNo] varchar(64) NOT NULL,
  [DocType] varchar(20) NOT NULL,
  [DocumentID] varchar(16) NOT NULL,
  [TransDate] datetime NOT NULL,
  [DipostingOlehAkunID] int NOT NULL,
  [DipostingPada] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([BackfillID])
);
GO

CREATE TABLE [dbo].[DashboardGLPostingBackfillDetail] (
  [DetailID] int IDENTITY(1,1) NOT NULL,
  [BackfillID] int NOT NULL,
  [GeneralLedgerID] varchar(16) NOT NULL,
  [AccountNo] varchar(20) NOT NULL,
  [Debit] decimal(18,6) NOT NULL,
  [Credit] decimal(18,6) NOT NULL,
  PRIMARY KEY CLUSTERED ([DetailID])
);
GO

CREATE TABLE [dbo].[DashboardJadwalTimProduksi] (
  [JadwalID] int IDENTITY(1,1) NOT NULL,
  [TanggalUsaha] date NOT NULL,
  [Shift] tinyint NOT NULL,
  [TimID] int NOT NULL,
  [CreatedByAkunID] int NOT NULL,
  [ModifiedDate] datetime NULL,
  PRIMARY KEY CLUSTERED ([JadwalID]),
  CONSTRAINT [UQ_JadwalTim_TanggalShift] UNIQUE NONCLUSTERED ([TanggalUsaha], [Shift])
);
GO

CREATE TABLE [dbo].[DashboardKasKecilPengeluaran] (
  [PengeluaranID] int IDENTITY(1,1) NOT NULL,
  [KasKecilShiftID] int NOT NULL,
  [Keterangan] varchar(200) NOT NULL,
  [Nominal] decimal(18,2) NOT NULL,
  [DicatatOlehAkunID] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NULL,
  PRIMARY KEY CLUSTERED ([PengeluaranID])
);
GO

CREATE TABLE [dbo].[DashboardKasKecilSaldoAwal] (
  [SaldoAwal] decimal(18,2) NOT NULL DEFAULT ((0)),
  [DiisiOlehAkunID] int NULL,
  [ModifiedDate] datetime NULL
);
GO

CREATE TABLE [dbo].[DashboardKasKecilShift] (
  [KasKecilShiftID] int IDENTITY(1,1) NOT NULL,
  [TanggalUsaha] date NOT NULL,
  [Shift] tinyint NOT NULL,
  [ShiftMulai] datetime NOT NULL,
  [KasMasuk] decimal(18,2) NOT NULL DEFAULT ((0)),
  [DiisiOlehAkunID] int NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NULL,
  PRIMARY KEY CLUSTERED ([KasKecilShiftID]),
  CONSTRAINT [UQ_KasKecilShift_TanggalShift] UNIQUE NONCLUSTERED ([TanggalUsaha], [Shift])
);
GO

CREATE TABLE [dbo].[DashboardKoreksiStokPallet] (
  [KoreksiID] int IDENTITY(1,1) NOT NULL,
  [Jenis] varchar(20) NOT NULL,
  [BatchID] int NULL,
  [TanggalUsaha] date NULL,
  [Shift] tinyint NULL,
  [QtyLama] int NULL,
  [QtyBaru] int NOT NULL,
  [Alasan] nvarchar(500) NOT NULL,
  [DicatatOlehAkunID] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([KoreksiID])
);
GO

CREATE TABLE [dbo].[DashboardLaporanShiftStokEsSnapshot] (
  [SnapshotID] int IDENTITY(1,1) NOT NULL,
  [TanggalUsaha] date NOT NULL,
  [Shift] tinyint NOT NULL,
  [TotalSisaQty10KG] decimal(18,2) NOT NULL,
  [CreatedDate] datetime NOT NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  PRIMARY KEY CLUSTERED ([SnapshotID]),
  CONSTRAINT [UQ_LaporanShiftStokEsSnapshot] UNIQUE NONCLUSTERED ([TanggalUsaha], [Shift])
);
GO

CREATE TABLE [dbo].[DashboardMarketingMitra] (
  [MarketingMitraID] int IDENTITY(1,1) NOT NULL,
  [MarketingUserID] varchar(16) NOT NULL,
  [BusinessPartnerID] varchar(16) NOT NULL,
  [CreatedByUserID] varchar(16) NOT NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([MarketingMitraID])
);
GO

CREATE TABLE [dbo].[DashboardMarketingVisitLog] (
  [LogID] int IDENTITY(1,1) NOT NULL,
  [BusinessPartnerID] varchar(16) NOT NULL,
  [LogDate] date NOT NULL,
  [HasilKunjungan] nvarchar(500) NULL,
  [CreatedByUserID] varchar(16) NOT NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedAt] datetime NULL,
  [FotoTampakDepanPath] varchar(512) NULL,
  [FotoPenagihanPath] varchar(512) NULL,
  [Latitude] decimal(10,7) NULL,
  [Longitude] decimal(10,7) NULL,
  [IsTerverifikasi] bit NOT NULL DEFAULT ((0)),
  [VerifiedAt] datetime NULL,
  PRIMARY KEY CLUSTERED ([LogID]),
  CONSTRAINT [UQ_DashboardMarketingVisitLog_Mitra_Date] UNIQUE NONCLUSTERED ([BusinessPartnerID], [LogDate])
);
GO

CREATE TABLE [dbo].[DashboardMarketingWilayah] (
  [MarketingWilayahID] int IDENTITY(1,1) NOT NULL,
  [MarketingUserID] varchar(16) NOT NULL,
  [Wilayah] varchar(128) NOT NULL,
  [Kecamatan] varchar(128) NULL,
  [CreatedByUserID] varchar(16) NOT NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([MarketingWilayahID])
);
GO

CREATE TABLE [dbo].[DashboardMitraCapacitySnapshot] (
  [SnapshotID] int IDENTITY(1,1) NOT NULL,
  [MonthStart] date NOT NULL,
  [BusinessPartnerID] varchar(16) NOT NULL,
  [Capacity] decimal(23,4) NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([SnapshotID])
);
GO

CREATE TABLE [dbo].[DashboardMitraCompetitor] (
  [BusinessPartnerID] varchar(16) NOT NULL,
  [Kompetitor] varchar(1024) NULL,
  [UpdatedByUserID] varchar(16) NULL,
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([BusinessPartnerID])
);
GO

CREATE TABLE [dbo].[DashboardMitraContactLog] (
  [LogID] int IDENTITY(1,1) NOT NULL,
  [BusinessPartnerID] varchar(16) NOT NULL,
  [LogDate] date NOT NULL,
  [ContactType] varchar(10) NOT NULL,
  [HasilPenawaran] nvarchar(500) NULL,
  [AngkaPemesanan] decimal(18,2) NULL,
  [AlasanTidakSesuai] nvarchar(500) NULL,
  [CreatedByUserID] varchar(16) NOT NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedAt] datetime NULL,
  PRIMARY KEY CLUSTERED ([LogID]),
  CONSTRAINT [UQ_DashboardMitraContactLog_Mitra_Date_Type] UNIQUE NONCLUSTERED ([BusinessPartnerID], [LogDate], [ContactType])
);
GO

CREATE TABLE [dbo].[DashboardMitraLocation] (
  [BusinessPartnerID] varchar(16) NOT NULL,
  [Latitude] decimal(10,7) NOT NULL,
  [Longitude] decimal(10,7) NOT NULL,
  [Alamat] varchar(512) NULL,
  [CreatedByUserID] varchar(16) NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([BusinessPartnerID])
);
GO

CREATE TABLE [dbo].[DashboardMitraPengajuan] (
  [PengajuanID] int IDENTITY(1,1) NOT NULL,
  [MarketingUserID] varchar(16) NOT NULL,
  [NamaCalon] varchar(128) NOT NULL,
  [NoHP] varchar(50) NULL,
  [WaktuPermintaanSampai] datetime NULL,
  [QtyKantong] decimal(23,4) NULL,
  [PriceLevel] int NULL,
  [Wilayah] varchar(128) NULL,
  [Kecamatan] varchar(128) NULL,
  [Alamat] varchar(1024) NULL,
  [Latitude] decimal(10,7) NULL,
  [Longitude] decimal(10,7) NULL,
  [Status] varchar(20) NOT NULL DEFAULT ('Menunggu'),
  [CatatanTolak] varchar(512) NULL,
  [ConvertedBusinessPartnerID] varchar(16) NULL,
  [ReviewedByUserID] varchar(16) NULL,
  [ReviewedAt] datetime NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [Kapasitas] decimal(23,4) NULL,
  [Kompetitor] varchar(1024) NULL,
  [Keterangan] varchar(500) NULL,
  PRIMARY KEY CLUSTERED ([PengajuanID])
);
GO

CREATE TABLE [dbo].[DashboardMonthlyTarget] (
  [TargetYear] int NOT NULL,
  [TargetMonth] int NOT NULL,
  [TargetNominal] decimal(23,4) NOT NULL,
  [TargetQty] decimal(23,4) NOT NULL,
  [CreatedByUserID] varchar(16) NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  CONSTRAINT [PK_DashboardMonthlyTarget] PRIMARY KEY CLUSTERED ([TargetYear], [TargetMonth])
);
GO

CREATE TABLE [dbo].[DashboardNotification] (
  [NotificationID] int IDENTITY(1,1) NOT NULL,
  [Type] varchar(32) NOT NULL,
  [TargetModuleKey] varchar(32) NOT NULL,
  [Title] varchar(200) NOT NULL,
  [Message] varchar(400) NOT NULL,
  [LinkUrl] varchar(200) NOT NULL,
  [SourceType] varchar(32) NOT NULL,
  [SourceID] varchar(64) NOT NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([NotificationID]),
  CONSTRAINT [UQ_DashboardNotification_Source] UNIQUE NONCLUSTERED ([SourceType], [SourceID])
);
GO

CREATE TABLE [dbo].[DashboardNotificationRead] (
  [NotificationID] int NOT NULL,
  [UserID] int NOT NULL,
  [ReadAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([NotificationID], [UserID])
);
GO

CREATE TABLE [dbo].[DashboardNotificationScanState] (
  [SourceType] varchar(32) NOT NULL,
  [LastScannedAt] datetime NOT NULL,
  PRIMARY KEY CLUSTERED ([SourceType])
);
GO

CREATE TABLE [dbo].[DashboardPabrikLocation] (
  [ID] int IDENTITY(1,1) NOT NULL,
  [Latitude] decimal(10,7) NOT NULL,
  [Longitude] decimal(10,7) NOT NULL,
  [Alamat] varchar(512) NULL,
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([ID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanBBM] (
  [BBMID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [SalesmanID] varchar(16) NOT NULL,
  [Liter] decimal(10,2) NULL,
  [WaktuIsi] datetime NOT NULL DEFAULT (getdate()),
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [NominalAsli] decimal(18,2) NULL,
  [NominalEkstra] decimal(18,2) NULL,
  [WaktuMasukSpbu] datetime NULL,
  PRIMARY KEY CLUSTERED ([BBMID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanIstirahat] (
  [IstirahatID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [SalesmanID] varchar(16) NOT NULL,
  [Keterangan] varchar(200) NOT NULL,
  [WaktuMulai] datetime NOT NULL DEFAULT (getdate()),
  [WaktuSelesai] datetime NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([IstirahatID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanJadwal] (
  [JadwalID] int IDENTITY(1,1) NOT NULL,
  [ArmadaID] int NOT NULL,
  [SalesmanID] varchar(16) NULL,
  [JamJadwal] datetime NOT NULL,
  [JamMulaiMuat] datetime NULL,
  [JamAktualBerangkat] datetime NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [Status] varchar(10) NOT NULL DEFAULT ('Draft'),
  [CreatedByUserID] varchar(16) NULL,
  [JarakKM] decimal(10,2) NULL,
  [DurasiMenit] int NULL,
  [JamSelesaiMuat] datetime NULL,
  [Qty5KGDimuat] int NULL,
  [CreatedDate] datetime NOT NULL CONSTRAINT [DF_DashboardPengirimanJadwal_CreatedDate] DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([JadwalID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanJadwalDetail] (
  [JadwalDetailID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [DeliveryOrderID] varchar(16) NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [SalesOrderID] varchar(16) NOT NULL DEFAULT (''),
  [Urutan] int NOT NULL DEFAULT ((0)),
  [SalesInvoiceID] varchar(16) NULL,
  [UrutanOverride] int NULL,
  PRIMARY KEY CLUSTERED ([JadwalDetailID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanKendala] (
  [KendalaID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [JadwalDetailID] int NOT NULL,
  [SalesmanID] varchar(16) NOT NULL,
  [JenisKendala] varchar(50) NOT NULL,
  [HubungiTeknisi] bit NOT NULL DEFAULT ((0)),
  [WaktuLapor] datetime NOT NULL DEFAULT (getdate()),
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([KendalaID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanReturResale] (
  [ResaleID] int IDENTITY(1,1) NOT NULL,
  [StopDeliveryItemID] int NOT NULL,
  [Jalur] varchar(20) NOT NULL,
  [Qty] decimal(23,4) NOT NULL,
  [TargetSalesOrderDetailID] varchar(16) NULL,
  [SalesOrderID] varchar(16) NULL,
  [LokasiLat] decimal(10,7) NULL,
  [LokasiLng] decimal(10,7) NULL,
  [DicatatOlehAkunID] int NOT NULL,
  [DicatatVia] varchar(10) NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([ResaleID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanStopDelivery] (
  [StopDeliveryID] int IDENTITY(1,1) NOT NULL,
  [JadwalDetailID] int NOT NULL,
  [JamTiba] datetime NULL,
  [JamSelesai] datetime NULL,
  [FotoBuktiPengirimanUrl] varchar(255) NULL,
  [FotoBuktiMuatanUrl] varchar(255) NULL,
  [TandaTanganUrl] varchar(255) NULL,
  [TanpaPembayaran] bit NOT NULL DEFAULT ((0)),
  [SalesReturnID] varchar(16) NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [FotoBuktiUrls] varchar(MAX) NULL,
  PRIMARY KEY CLUSTERED ([StopDeliveryID]),
  CONSTRAINT [UQ_DashboardPengirimanStopDelivery_JadwalDetailID] UNIQUE NONCLUSTERED ([JadwalDetailID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanStopDeliveryItem] (
  [StopDeliveryItemID] int IDENTITY(1,1) NOT NULL,
  [StopDeliveryID] int NOT NULL,
  [SalesOrderDetailID] varchar(16) NOT NULL,
  [ItemID] varchar(160) NOT NULL,
  [QtyDimuat] decimal(23,4) NOT NULL,
  [QtyDiterima] decimal(23,4) NOT NULL,
  [QtyRetur] decimal(23,4) NOT NULL,
  [FotoReturUrl] varchar(255) NULL,
  [KeteranganRetur] varchar(500) NULL,
  [KondisiRetur] varchar(10) NULL,
  PRIMARY KEY CLUSTERED ([StopDeliveryItemID])
);
GO

CREATE TABLE [dbo].[DashboardPengirimanTerkendala] (
  [TerkendalaID] int IDENTITY(1,1) NOT NULL,
  [JadwalDetailID] int NOT NULL,
  [SalesmanID] varchar(16) NOT NULL,
  [Alasan] varchar(200) NOT NULL,
  [IsResolved] bit NOT NULL DEFAULT ((0)),
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([TerkendalaID])
);
GO

CREATE TABLE [dbo].[DashboardPerusahaan] (
  [PerusahaanID] int IDENTITY(1,1) NOT NULL,
  [Nama] varchar(128) NOT NULL,
  [JenisBisnis] varchar(128) NULL,
  [Wilayah] varchar(128) NULL,
  [PabrikLatitude] decimal(10,7) NULL,
  [PabrikLongitude] decimal(10,7) NULL,
  [PabrikAlamat] varchar(512) NULL,
  [Status] varchar(20) NOT NULL DEFAULT ('Draft'),
  [StandaloneUrl] varchar(512) NULL,
  [DbServer] varchar(256) NULL,
  [DbPort] int NULL,
  [DbName] varchar(128) NULL,
  [DbUser] varchar(128) NULL,
  [DbPasswordEncrypted] varchar(512) NULL,
  [Catatan] varchar(1024) NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [Kode] varchar(32) NULL,
  PRIMARY KEY CLUSTERED ([PerusahaanID])
);
GO

CREATE TABLE [dbo].[DashboardPrintFormatSettings] (
  [ID] int IDENTITY(1,1) NOT NULL,
  [ShowMitraAddress] bit NOT NULL DEFAULT ((1)),
  [ShowDriverName] bit NOT NULL DEFAULT ((1)),
  [ShowBankTransfer] bit NOT NULL DEFAULT ((1)),
  [ShowQrCode] bit NOT NULL DEFAULT ((1)),
  [ShowDisclaimer] bit NOT NULL DEFAULT ((1)),
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([ID])
);
GO

CREATE TABLE [dbo].[DashboardPrintQueue] (
  [PrintQueueID] int IDENTITY(1,1) NOT NULL,
  [SalesInvoiceID] varchar(16) NOT NULL,
  [JadwalID] int NULL,
  [IsManual] bit NOT NULL DEFAULT ((0)),
  [Status] varchar(20) NOT NULL DEFAULT ('Pending'),
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  [PrintedAt] datetime NULL,
  [FailCount] int NOT NULL DEFAULT ((0)),
  [SortOrder] int NULL,
  PRIMARY KEY CLUSTERED ([PrintQueueID])
);
GO

CREATE TABLE [dbo].[DashboardProduksiBatch] (
  [BatchID] int IDENTITY(1,1) NOT NULL,
  [MesinID] int NOT NULL,
  [PosisiID] int NOT NULL,
  [TanggalProduksi] datetime NOT NULL DEFAULT (getdate()),
  [Qty10KG] int NOT NULL DEFAULT ((0)),
  [SisaQty10KG] int NOT NULL DEFAULT ((0)),
  [DicatatOlehAkunID] int NOT NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [TanggalLabel] date NOT NULL DEFAULT (CONVERT([date],getdate())),
  [Shift] tinyint NOT NULL DEFAULT ((1)),
  [JamPanen] varchar(5) NULL,
  [KualitasID] int NULL,
  PRIMARY KEY CLUSTERED ([BatchID])
);
GO

CREATE TABLE [dbo].[DashboardProduksiKualitas] (
  [KualitasID] int IDENTITY(1,1) NOT NULL,
  [TanggalLabel] date NOT NULL,
  [Waktu] varchar(5) NOT NULL,
  [Shift] tinyint NOT NULL,
  [MesinID] int NOT NULL,
  [CekKejernihan] bit NOT NULL,
  [CekUkuranBentuk] bit NOT NULL,
  [Catatan] nvarchar(500) NULL,
  [FotoPath] varchar(256) NULL,
  [CreatedByUserID] varchar(16) NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [Qty10KG] int NULL,
  [DiameterDalamMm] decimal(5,1) NULL,
  [FotoBeratKemasanPath] varchar(256) NULL,
  [Variant] varchar(8) NOT NULL CONSTRAINT [DF_DashboardProduksiKualitas_Variant] DEFAULT ('10kg'),
  PRIMARY KEY CLUSTERED ([KualitasID])
);
GO

CREATE TABLE [dbo].[DashboardProduksiMesin] (
  [MesinID] int IDENTITY(1,1) NOT NULL,
  [Nama] varchar(100) NOT NULL,
  [KapasitasProduksiPerHari] int NOT NULL DEFAULT ((0)),
  [KonsumsiListrikKWh] decimal(10,2) NOT NULL DEFAULT ((0)),
  [LamaProduksiMenit] int NOT NULL DEFAULT ((0)),
  [LamaPengemasanMenit] int NOT NULL DEFAULT ((0)),
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [Status] varchar(20) NOT NULL DEFAULT ('AKTIF'),
  PRIMARY KEY CLUSTERED ([MesinID])
);
GO

CREATE TABLE [dbo].[DashboardProduksiMesinEvent] (
  [EventID] int IDENTITY(1,1) NOT NULL,
  [MesinID] int NOT NULL,
  [JenisEvent] varchar(10) NOT NULL,
  [WaktuEvent] datetime NOT NULL,
  [DicatatOlehAkunID] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([EventID])
);
GO

CREATE TABLE [dbo].[DashboardProduksiMuatanDetail] (
  [MuatanDetailID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [BatchID] int NOT NULL,
  [Qty10KGDiambil] int NOT NULL DEFAULT ((0)),
  [DicatatOlehAkunID] int NOT NULL,
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([MuatanDetailID])
);
GO

CREATE TABLE [dbo].[DashboardProduksiPalletPosisi] (
  [PosisiID] int IDENTITY(1,1) NOT NULL,
  [Kode] varchar(4) NOT NULL,
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([PosisiID]),
  CONSTRAINT [UQ_DashboardProduksiPalletPosisi_Kode] UNIQUE NONCLUSTERED ([Kode])
);
GO

CREATE TABLE [dbo].[DashboardSalesPaymentMetode] (
  [SalesPaymentID] varchar(16) NOT NULL,
  [MetodeKode] varchar(64) NOT NULL,
  [Catatan] varchar(500) NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([SalesPaymentID])
);
GO

CREATE TABLE [dbo].[DashboardSatpamJadwalJaga] (
  [JadwalJagaID] int IDENTITY(1,1) NOT NULL,
  [TanggalUsaha] date NOT NULL,
  [ShiftType] varchar(12) NOT NULL,
  [SatpamAkunID] int NOT NULL,
  [Catatan] varchar(256) NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [CreatedByAkunID] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([JadwalJagaID])
);
GO

CREATE TABLE [dbo].[DashboardSatpamPatroliFoto] (
  [FotoID] int IDENTITY(1,1) NOT NULL,
  [SesiID] int NOT NULL,
  [TitikPatroli] varchar(50) NULL,
  [Keterangan] varchar(256) NULL,
  [FotoPath] varchar(256) NOT NULL,
  [Latitude] decimal(10,7) NULL,
  [Longitude] decimal(10,7) NULL,
  [WaktuFoto] datetime NOT NULL DEFAULT (getdate()),
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  PRIMARY KEY CLUSTERED ([FotoID])
);
GO

CREATE TABLE [dbo].[DashboardSatpamPatroliSesi] (
  [SesiID] int IDENTITY(1,1) NOT NULL,
  [SatpamAkunID] int NOT NULL,
  [ShiftType] varchar(12) NULL,
  [TanggalUsahaShift] date NULL,
  [MulaiWaktu] datetime NOT NULL DEFAULT (getdate()),
  [SelesaiWaktu] datetime NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([SesiID])
);
GO

CREATE TABLE [dbo].[DashboardSatpamTamu] (
  [KunjunganID] int IDENTITY(1,1) NOT NULL,
  [NamaTamu] varchar(128) NOT NULL,
  [AsalInstansi] varchar(128) NULL,
  [TujuanKunjungan] varchar(256) NOT NULL,
  [Dikunjungi] varchar(128) NOT NULL,
  [NomorKendaraan] varchar(32) NULL,
  [FotoMasukPath] varchar(256) NOT NULL,
  [FotoMasukLatitude] decimal(10,7) NULL,
  [FotoMasukLongitude] decimal(10,7) NULL,
  [WaktuMasuk] datetime NOT NULL DEFAULT (getdate()),
  [FotoKeluarPath] varchar(256) NULL,
  [FotoKeluarLatitude] decimal(10,7) NULL,
  [FotoKeluarLongitude] decimal(10,7) NULL,
  [WaktuKeluar] datetime NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([KunjunganID])
);
GO

CREATE TABLE [dbo].[DashboardSiteSettings] (
  [ID] int IDENTITY(1,1) NOT NULL,
  [Title] varchar(128) NOT NULL,
  [Description] varchar(512) NULL,
  [FaviconPath] varchar(256) NULL,
  [OgImagePath] varchar(256) NULL,
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([ID])
);
GO

CREATE TABLE [dbo].[DashboardStokBahanBakuSaldoAwal] (
  [JenisBarang] varchar(20) NOT NULL,
  [SaldoAwalGudang] int NOT NULL DEFAULT ((0)),
  [SaldoAwalInventoriOperasional] int NOT NULL DEFAULT ((0)),
  [DiisiOlehAkunID] int NULL,
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([JenisBarang])
);
GO

CREATE TABLE [dbo].[DashboardStokBahanBakuShift] (
  [StokBahanBakuID] bigint IDENTITY(1,1) NOT NULL,
  [TanggalUsaha] date NOT NULL,
  [Shift] tinyint NOT NULL,
  [ShiftMulai] datetime NOT NULL,
  [JenisBarang] varchar(20) NOT NULL,
  [StokMasukGudang] int NOT NULL DEFAULT ((0)),
  [StokMasukInventoriOperasional] int NOT NULL DEFAULT ((0)),
  [StokDipakaiProduksi] int NOT NULL DEFAULT ((0)),
  [StokRusakProduksi] int NOT NULL DEFAULT ((0)),
  [OperasionalAkunID] int NULL,
  [OperasionalDiisiPada] datetime NULL,
  [ProduksiAkunID] int NULL,
  [ProduksiDiisiPada] datetime NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([StokBahanBakuID]),
  CONSTRAINT [UQ_StokBahanBakuShift] UNIQUE NONCLUSTERED ([TanggalUsaha], [Shift], [JenisBarang])
);
GO

CREATE TABLE [dbo].[DashboardTakeAwayAlokasi] (
  [TakeAwayAlokasiID] int IDENTITY(1,1) NOT NULL,
  [TakeAwayMuatanID] int NOT NULL,
  [SumberTipe] varchar(10) NOT NULL,
  [KualitasID] int NULL,
  [BatchID] int NULL,
  [Qty] int NOT NULL,
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([TakeAwayAlokasiID])
);
GO

CREATE TABLE [dbo].[DashboardTakeAwayMuatan] (
  [TakeAwayMuatanID] int IDENTITY(1,1) NOT NULL,
  [SalesOrderID] varchar(16) NOT NULL,
  [Variant] varchar(8) NOT NULL,
  [QtyDipesan] int NOT NULL,
  [JamMulaiMuat] datetime NULL,
  [JamSelesaiMuat] datetime NULL,
  [QtyDimuat] int NULL,
  [DicatatOlehAkunID] int NULL,
  [DeliveryOrderID] varchar(16) NULL,
  [SalesInvoiceID] varchar(16) NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([TakeAwayMuatanID]),
  UNIQUE NONCLUSTERED ([SalesOrderID])
);
GO

CREATE TABLE [dbo].[DashboardTimProduksi] (
  [TimID] int IDENTITY(1,1) NOT NULL,
  [Nama] varchar(50) NOT NULL,
  [KepalaAkunID] int NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NULL,
  [WakilKepalaAkunID] int NULL,
  PRIMARY KEY CLUSTERED ([TimID])
);
GO

CREATE TABLE [dbo].[DashboardTimProduksiAnggota] (
  [AnggotaID] int IDENTITY(1,1) NOT NULL,
  [Nama] varchar(100) NOT NULL,
  [IsDeleted] bit NOT NULL DEFAULT ((0)),
  [CreatedDate] datetime NOT NULL DEFAULT (getdate()),
  [ModifiedDate] datetime NOT NULL DEFAULT (getdate()),
  [TimID] int NOT NULL,
  [AkunID] int NULL,
  PRIMARY KEY CLUSTERED ([AnggotaID])
);
GO

CREATE TABLE [dbo].[DashboardVehicleCheck] (
  [VehicleCheckID] int IDENTITY(1,1) NOT NULL,
  [JadwalID] int NOT NULL,
  [Tipe] varchar(10) NOT NULL,
  [OdometerKM] int NOT NULL,
  [CheckedByUserID] varchar(16) NOT NULL,
  [CheckedAt] datetime NOT NULL DEFAULT (getdate()),
  [FuelBar] tinyint NOT NULL,
  [MuatanQty] int NOT NULL,
  [Remark] nvarchar(500) NULL,
  PRIMARY KEY CLUSTERED ([VehicleCheckID]),
  CONSTRAINT [UQ_VehicleCheck_JadwalTipe] UNIQUE NONCLUSTERED ([JadwalID], [Tipe])
);
GO

CREATE TABLE [dbo].[DashboardVehicleCheckPhoto] (
  [VehicleCheckPhotoID] int IDENTITY(1,1) NOT NULL,
  [VehicleCheckID] int NOT NULL,
  [JenisFoto] varchar(16) NOT NULL,
  [FilePath] varchar(256) NOT NULL,
  [CreatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([VehicleCheckPhotoID]),
  CONSTRAINT [UQ_VehicleCheckPhoto_CheckJenis] UNIQUE NONCLUSTERED ([VehicleCheckID], [JenisFoto])
);
GO

CREATE TABLE [dbo].[DashboardWilayahPotentialTarget] (
  [Wilayah] varchar(128) NOT NULL,
  [PotentialTarget] decimal(23,4) NOT NULL DEFAULT ((0)),
  [UpdatedByUserID] varchar(16) NULL,
  [UpdatedAt] datetime NOT NULL DEFAULT (getdate()),
  PRIMARY KEY CLUSTERED ([Wilayah])
);
GO

CREATE NONCLUSTERED INDEX [IX_DeliveryOrder_TransDate] ON [dbo].[DeliveryOrder] ([TransDate]);
GO
CREATE NONCLUSTERED INDEX [NonClusteredIndex-20220211-170707] ON [dbo].[DeliveryOrderDetail] ([DeliveryOrderID], [ItemID]);
GO
CREATE NONCLUSTERED INDEX [IX_GeneralLedger_COA_TransDate] ON [dbo].[GeneralLedger] ([ChartOfAccountID], [TransDate]) INCLUDE ([Debit], [Credit], [BranchID]);
GO
CREATE CLUSTERED INDEX [ClusteredIndex-20220211-170621] ON [dbo].[ItemAverage] ([Year], [Month], [ItemID]);
GO
CREATE NONCLUSTERED INDEX [IX_SalesInvoice_TransDate] ON [dbo].[SalesInvoice] ([TransDate]);
GO
CREATE NONCLUSTERED INDEX [NonClusteredIndex-20220211-170751] ON [dbo].[SalesInvoiceDetail] ([SalesInvoiceID], [ItemID]);
GO
CREATE NONCLUSTERED INDEX [IX_SalesOrder_TransDate] ON [dbo].[SalesOrder] ([TransDate]);
GO
CREATE NONCLUSTERED INDEX [IX_SalesPayment_TransDate] ON [dbo].[SalesPayment] ([TransDate]);
GO
CREATE NONCLUSTERED INDEX [IX_SalesPaymentDetail_SalesPaymentID] ON [dbo].[SalesPaymentDetail] ([SalesPaymentID]);
GO
CREATE NONCLUSTERED INDEX [IX_DashboardCashFlowExpense_BusinessDate] ON [dbo].[DashboardCashFlowExpense] ([BusinessDate]);
GO
CREATE UNIQUE NONCLUSTERED INDEX [UX_DashboardMarketingMitra_BusinessPartnerID] ON [dbo].[DashboardMarketingMitra] ([BusinessPartnerID]);
GO
CREATE NONCLUSTERED INDEX [IX_DashboardMarketingVisitLog_Mitra_Date] ON [dbo].[DashboardMarketingVisitLog] ([BusinessPartnerID], [LogDate]);
GO
CREATE UNIQUE NONCLUSTERED INDEX [UX_DashboardMitraCapacitySnapshot_MonthStart_BusinessPartnerID] ON [dbo].[DashboardMitraCapacitySnapshot] ([MonthStart], [BusinessPartnerID]);
GO
CREATE NONCLUSTERED INDEX [IX_DashboardMitraContactLog_Mitra_Date] ON [dbo].[DashboardMitraContactLog] ([BusinessPartnerID], [LogDate]);
GO
ALTER TABLE [dbo].[DashboardCollectionTarget] ADD CONSTRAINT [FK_DashboardCollectionTarget_BusinessPartner] FOREIGN KEY ([BusinessPartnerID]) REFERENCES [dbo].[BusinessPartner] ([BusinessPartnerID]);
GO
ALTER TABLE [dbo].[DashboardMitraLocation] ADD CONSTRAINT [FK_DashboardMitraLocation_BusinessPartner] FOREIGN KEY ([BusinessPartnerID]) REFERENCES [dbo].[BusinessPartner] ([BusinessPartnerID]);
GO
ALTER TABLE [dbo].[DashboardMitraCompetitor] ADD CONSTRAINT [FK_DashboardMitraCompetitor_BusinessPartner] FOREIGN KEY ([BusinessPartnerID]) REFERENCES [dbo].[BusinessPartner] ([BusinessPartnerID]);
GO
ALTER TABLE [dbo].[DashboardGLPostingBackfillDetail] ADD FOREIGN KEY ([BackfillID]) REFERENCES [dbo].[DashboardGLPostingBackfill] ([BackfillID]);
GO
ALTER TABLE [dbo].[DashboardVehicleCheckPhoto] ADD FOREIGN KEY ([VehicleCheckID]) REFERENCES [dbo].[DashboardVehicleCheck] ([VehicleCheckID]);
GO
ALTER TABLE [dbo].[DashboardPengirimanReturResale] ADD CONSTRAINT [FK_ReturResale_StopDeliveryItem] FOREIGN KEY ([StopDeliveryItemID]) REFERENCES [dbo].[DashboardPengirimanStopDeliveryItem] ([StopDeliveryItemID]);
GO
ALTER TABLE [dbo].[DashboardTakeAwayAlokasi] ADD FOREIGN KEY ([TakeAwayMuatanID]) REFERENCES [dbo].[DashboardTakeAwayMuatan] ([TakeAwayMuatanID]);
GO
ALTER TABLE [dbo].[DashboardVehicleCheck] ADD FOREIGN KEY ([JadwalID]) REFERENCES [dbo].[DashboardPengirimanJadwal] ([JadwalID]);
GO
ALTER TABLE [dbo].[DashboardTakeAwayAlokasi] ADD FOREIGN KEY ([BatchID]) REFERENCES [dbo].[DashboardProduksiBatch] ([BatchID]);
GO
ALTER TABLE [dbo].[DashboardNotificationRead] ADD FOREIGN KEY ([NotificationID]) REFERENCES [dbo].[DashboardNotification] ([NotificationID]);
GO
ALTER TABLE [dbo].[DashboardBudget] ADD CONSTRAINT [FK_DashboardBudget_COA] FOREIGN KEY ([ChartOfAccountID]) REFERENCES [dbo].[ChartOfAccount] ([ChartOfAccountID]);
GO
ALTER TABLE [dbo].[DashboardTakeAwayAlokasi] ADD FOREIGN KEY ([KualitasID]) REFERENCES [dbo].[DashboardProduksiKualitas] ([KualitasID]);
GO

--VERSION : 18.05.03.14--
CREATE VIEW [dbo].[vCustomerStatement] AS 
	SELECT A.SalesInvoiceID, A.VoucherNo, A.TransDate, A.Netto, A.Deposit, 0 AS Paid, 0 AS OtherPayment
	FROM SalesInvoice A
	WHERE A.IsDeleted = 0
	UNION ALL
	SELECT B.SalesInvoiceID, A.VoucherNo, A.TransDate, 0, 0, B.Amount AS Paid, ISNULL(B.AddTax, 0) + ISNULL(B.DiscRp, 0) + ISNULL(B.Expense, 0) AS OtherPayment
	FROM SalesPayment A
		INNER JOIN SalesPaymentDetail B ON A.SalesPaymentID = B.SalesPaymentID
	WHERE A.IsDeleted = 0

--SELECT A.SalesInvoiceID AS SalesInvoiceID, A.BusinessPartnerID, A.VoucherNo, A.TransDate, A.Netto AS Increase, 0 AS Paid, 'SalesInvoice' AS [Type], 0 AS OtherPayment
--FROM SalesInvoice A
--WHERE A.IsDeleted = 0
--UNION ALL
--SELECT A.SalesDepositID, A.BusinessPartnerID, A.VoucherNo, A.TransDate, 0, A.Amount, 'SalesDeposit', 0 AS OtherPayment
--FROM SalesDeposit A
--WHERE A.IsDeleted = 0
--UNION ALL
--SELECT A.SalesDebitID AS Oid, A.BusinessPartnerID, A.VoucherNo, A.TransDate, A.Netto, 0, 'SalesDebit' AS [Type], 0 AS OtherPayment
--FROM SalesDebit A
--WHERE A.IsDeleted = 0
--UNION ALL
--SELECT A.SalesCreditID AS Oid, A.BusinessPartnerID, A.VoucherNo, A.TransDate, 0, A.Netto, 'SalesCredit' AS [Type], 0 AS OtherPayment
--FROM SalesCredit A
--WHERE A.IsDeleted = 0
--UNION ALL
--SELECT A.SalesPaymentID AS Oid, A.BusinessPartnerID, A.VoucherNo, A.TransDate, 0, B.Amount, 'SalesPayment' AS [Type], 0 AS OtherPayment
--FROM SalesPayment A
--	INNER JOIN SalesPaymentDetail B ON A.SalesPaymentID = B.SalesPaymentID
--WHERE A.IsDeleted = 0
--UNION ALL
--SELECT A.SalesDepositCancelID AS Oid, A.BusinessPartnerID, A.VoucherNo, A.ReturnedDate, 0, A.ReturnedAmount, 'SalesPayment' AS [Type], 0 AS OtherPayment
--FROM SalesDepositCancel A
--WHERE A.IsDeleted = 0
GO

CREATE   TRIGGER dbo.trg_SalesInvoice_Changes
ON dbo.SalesInvoice
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    -- INSERT: rekam baris baru
    IF EXISTS (SELECT 1 FROM inserted)
        AND NOT EXISTS (SELECT 1 FROM deleted)
    BEGIN
        INSERT INTO dbo.SalesInvoiceChangeLog (SalesInvoiceID, ChangeType)
        SELECT SalesInvoiceID, 'INSERT' FROM inserted;
    END

    -- DELETE: rekam baris yang dihapus
    IF EXISTS (SELECT 1 FROM deleted)
        AND NOT EXISTS (SELECT 1 FROM inserted)
    BEGIN
        INSERT INTO dbo.SalesInvoiceChangeLog (SalesInvoiceID, ChangeType)
        SELECT SalesInvoiceID, 'DELETE' FROM deleted;
    END

    -- UPDATE: rekam perubahan (pakai SalesInvoiceID dari inserted/baris baru)
    IF EXISTS (SELECT 1 FROM inserted)
        AND EXISTS (SELECT 1 FROM deleted)
    BEGIN
        INSERT INTO dbo.SalesInvoiceChangeLog (SalesInvoiceID, ChangeType)
        SELECT SalesInvoiceID, 'UPDATE' FROM inserted;
    END
END;
GO
